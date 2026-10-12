// Copyright 2026 nohmi contributors
// SPDX-License-Identifier: Apache-2.0 OR MIT

use crate::error::{Error, Result};

const MAX_BYTES: usize = 1024 * 1024;

fn too_large() -> Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        "Update manifest exceeds 1 MiB",
    )
    .into()
}

pub(crate) async fn read(mut response: reqwest::Response) -> Result<serde_json::Value> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_BYTES as u64)
    {
        return Err(too_large());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if chunk.len() > MAX_BYTES - bytes.len() {
            return Err(too_large());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&bytes)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::Duration,
    };

    fn fetch(body: Vec<u8>, length: Option<usize>) -> Result<serde_json::Value> {
        #[cfg(feature = "rustls-tls")]
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 2048];
            stream.read(&mut request).unwrap();
            let length = length
                .map(|size| format!("Content-Length: {size}\r\n"))
                .unwrap_or_default();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{length}Connection: close\r\n\r\n").unwrap();
            // A capped reader deliberately closes before an oversized body finishes.
            let _ = stream.write_all(&body);
        });
        let result = tauri::async_runtime::block_on(async {
            let response = reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap()
                .get(format!("http://{address}"))
                .send()
                .await
                .unwrap();
            read(response).await
        });
        server.join().unwrap();
        result
    }

    #[test]
    fn accepts_json_at_the_exact_limit_without_content_length() {
        let body = format!("\"{}\"", "x".repeat(MAX_BYTES - 2)).into_bytes();
        assert_eq!(
            fetch(body, None).unwrap().as_str().unwrap().len(),
            MAX_BYTES - 2
        );
    }

    #[test]
    fn rejects_oversized_declared_length_before_reading_body() {
        assert!(
            matches!(fetch(vec![], Some(MAX_BYTES + 1)), Err(Error::Io(error)) if error.kind() == std::io::ErrorKind::InvalidData)
        );
    }

    #[test]
    fn rejects_oversized_stream_without_content_length() {
        assert!(
            matches!(fetch(vec![b'x'; MAX_BYTES + 1], None), Err(Error::Io(error)) if error.kind() == std::io::ErrorKind::InvalidData)
        );
    }

    #[test]
    fn preserves_json_validation() {
        assert!(matches!(
            fetch(b"{".to_vec(), Some(1)),
            Err(Error::Serialization(_))
        ));
        assert_eq!(
            fetch(b"{}".to_vec(), Some(2)).unwrap(),
            serde_json::json!({})
        );
    }
}
