fn main() {
    println!("cargo:rerun-if-env-changed=NOHMI_UPDATER_PUBLIC_KEY");
    #[cfg(target_os = "macos")]
    {
        swift_rs::SwiftLinker::new("14.0")
            .with_package("IloNative", "../macos")
            .link();
        println!("cargo:rerun-if-changed=../macos/Sources");
        // Swift 6.4 defaults to Swift Build, whose product path differs from
        // the legacy path emitted by swift-rs. Keep support for both engines.
        let profile = if std::env::var("PROFILE").as_deref() == Ok("release") {
            "Release"
        } else {
            "Debug"
        };
        let products =
            std::path::PathBuf::from(std::env::var("OUT_DIR").expect("Cargo output directory"))
                .join("swift-rs/IloNative/out/Products")
                .join(profile);
        if products.join("libIloNative.a").exists() {
            println!("cargo:rustc-link-search=native={}", products.display());
        }
        for framework in [
            "AppKit",
            "SwiftUI",
            "UserNotifications",
            "ServiceManagement",
            "WidgetKit",
            "Security",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::build()
}
