import CryptoKit
import Foundation
import Security

func ritualSessionBinding(account: String, token: String) -> [String: Any] {
  ["accountId": account, "credentialDigest": SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()]
}

func ritualBoundAccount(_ binding: [String: Any], token: String?) -> String? {
  guard let token, !token.isEmpty,
    let account = binding["accountId"] as? String, !account.isEmpty,
    let digest = binding["credentialDigest"] as? String,
    digest == ritualSessionBinding(account: account, token: token)["credentialDigest"] as? String
  else { return nil }
  return account
}

/// Private responses never enter the plain desktop preference or widget stores.
enum RitualStore {
 static func key(_ identity:String)throws->SymmetricKey {
  let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"app.personal-os.ritual-key",kSecAttrAccount as String:stableID(identity)]
  var lookup=query;lookup[kSecReturnData as String]=true;lookup[kSecMatchLimit as String]=kSecMatchLimitOne
  var result:CFTypeRef?;let status=SecItemCopyMatching(lookup as CFDictionary,&result)
  if status==errSecSuccess,let data=result as? Data {return SymmetricKey(data:data)}
  guard status==errSecItemNotFound else {throw NativeError.message("Unable to unlock ritual storage (\(status))")}
  let key=SymmetricKey(size:.bits256);var insert=query;insert[kSecValueData as String]=key.withUnsafeBytes{Data($0)};insert[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly
  try SessionKeychain.check(SecItemAdd(insert as CFDictionary,nil));return key
 }
 static func file(_ identity:String)throws->URL {
  let base=try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("app.personal-os.desktop/rituals",isDirectory:true)
  try FileManager.default.createDirectory(at:base,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
  return base.appendingPathComponent(stableID(identity)+".sealed")
 }
 static func read(_ identity:String)throws->[String:Any] {
  let url=try file(identity);guard FileManager.default.fileExists(atPath:url.path) else {return ["enabled":false,"queue":[],"state":NSNull()]}
  let sealed=try Data(contentsOf:url);let plain=try AES.GCM.open(AES.GCM.SealedBox(combined:sealed),using:key(identity),authenticating:Data(identity.utf8))
  guard let value=try JSONSerialization.jsonObject(with:plain) as? [String:Any] else {throw NativeError.message("Invalid ritual storage")};return value
 }
 static func delete(_ identity:String)throws {
  let url=try file(identity)
  if FileManager.default.fileExists(atPath:url.path) {try FileManager.default.removeItem(at:url)}
  let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"app.personal-os.ritual-key",kSecAttrAccount as String:stableID(identity)]
  let status=SecItemDelete(query as CFDictionary)
  if status != errSecItemNotFound {try SessionKeychain.check(status)}
 }
 static func write(_ identity:String,_ value:[String:Any])throws {
  let plain=try JSONSerialization.data(withJSONObject:value);guard plain.count<=768*1024 else {throw NativeError.message("Sync pending ritual changes before adding more.")}
  let sealed=try AES.GCM.seal(plain,using:key(identity),authenticating:Data(identity.utf8));guard let combined=sealed.combined else {throw NativeError.message("Cannot protect ritual data")}
  let url=try file(identity);try combined.write(to:url,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path)
 }
}
