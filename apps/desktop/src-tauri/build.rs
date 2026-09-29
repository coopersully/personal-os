fn main() {
    #[cfg(target_os = "macos")]
    {
        swift_rs::SwiftLinker::new("14.0")
            .with_package("IloNative", "../macos")
            .link();
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
