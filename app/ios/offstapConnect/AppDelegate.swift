import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

import FirebaseCore
import GoogleSignIn
import GoogleMaps
import UserNotifications   // 👈 NEW import

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate { // 👈 conform

  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {

    // ✅ Firebase init
    if FirebaseApp.app() == nil {
      FirebaseApp.configure()
    }

    // ✅ Google Maps
    if let apiKey = Bundle.main.object(forInfoDictionaryKey: "GMSApiKey") as? String {
      GMSServices.provideAPIKey(apiKey)
    } else {
      print("⚠️ GMSApiKey missing in Info.plist")
    }

    // 👇 Set notification delegate so alerts show in foreground
    UNUserNotificationCenter.current().delegate = self

    // --- React Native bootstrap ---
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "offstapConnect",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  // ✅ Allow foreground notifications (alerts, banners, sounds)
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound]) // 👈 shows even if app is open
  }

  // Handle Google Sign-In redirect
  func application(_ app: UIApplication,
                   open url: URL,
                   options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
    if GIDSignIn.sharedInstance.handle(url) {
      return true
    }
    return false
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
