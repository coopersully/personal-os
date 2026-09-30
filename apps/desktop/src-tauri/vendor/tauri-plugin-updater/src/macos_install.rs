// Copyright 2026 Nohmi contributors
// SPDX-License-Identifier: Apache-2.0 OR MIT

use std::{ffi::CString, io, os::unix::ffi::OsStrExt, path::Path};

unsafe extern "C" {
    fn renamex_np(from: *const std::ffi::c_char, to: *const std::ffi::c_char, flags: u32) -> i32;
}

/// macOS rename(2) RENAME_SWAP exchanges both names atomically or changes neither.
/// Never fall back to delete-then-move or move-then-restore.
pub(crate) fn exchange(staged: &Path, installed: &Path) -> io::Result<()> {
    let staged = CString::new(staged.as_os_str().as_bytes())?;
    let installed = CString::new(installed.as_os_str().as_bytes())?;
    // SAFETY: both pointers reference live NUL-terminated strings for this call.
    // RENAME_SWAP is 0x2 in the macOS SDK sys/stdio.h. Both directories were
    // created on the same filesystem; unsupported filesystems fail closed.
    let result = unsafe { renamex_np(staged.as_ptr(), installed.as_ptr(), 0x2) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn replacement_atomically_retains_old_bundle_until_after_success() {
        let root = tempfile::tempdir().unwrap();
        let installed = root.path().join("nohmi.app");
        fs::create_dir(&installed).unwrap();
        fs::write(installed.join("version"), "old").unwrap();
        let staged = tempfile::tempdir_in(root.path()).unwrap();
        fs::write(staged.path().join("version"), "new").unwrap();
        exchange(staged.path(), &installed).unwrap();
        assert_eq!(
            fs::read_to_string(installed.join("version")).unwrap(),
            "new"
        );
        assert_eq!(
            fs::read_to_string(staged.path().join("version")).unwrap(),
            "old"
        );
        drop(staged);
        assert_eq!(
            fs::read_to_string(installed.join("version")).unwrap(),
            "new"
        );
    }

    #[test]
    fn failed_exchange_never_moves_or_deletes_installed_bundle() {
        let root = tempfile::tempdir().unwrap();
        let installed = root.path().join("nohmi.app");
        fs::create_dir(&installed).unwrap();
        fs::write(installed.join("version"), "old").unwrap();
        assert!(exchange(&root.path().join("missing"), &installed).is_err());
        assert_eq!(
            fs::read_to_string(installed.join("version")).unwrap(),
            "old"
        );
    }
}
