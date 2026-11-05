import Foundation
import Capacitor
import UIKit

@objc(YorunRecorderPlugin)
public class YorunRecorderPlugin: CAPPlugin, CAPBridgedPlugin {
    private var sharing = false
    public let identifier = "YorunRecorderPlugin"
    public let jsName = "YorunRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "command", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportFile", returnType: CAPPluginReturnPromise)
    ]
    @objc func snapshot(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do { call.resolve(try RecorderEngine.shared.snapshot(call.getString("id"))) }
            catch { call.reject("저장된 기록을 읽지 못했습니다: \(error.localizedDescription)") }
        }
    }
    @objc func list(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do { call.resolve(try RecorderEngine.shared.list()) } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func command(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            RecorderEngine.shared.command(call.getString("action") ?? "") { error in
                if let error { call.reject(error.localizedDescription) } else { call.resolve() }
            }
        }
    }
    @objc func exportFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                guard !self.sharing else { throw RecorderError.message("열려 있는 공유 화면을 먼저 닫아주세요.") }
                let name = call.getString("filename") ?? "", data = call.getString("data") ?? ""
                guard name.range(of: "^yorun-[a-zA-Z0-9-]+\\.(gpx|json)$", options: .regularExpression) != nil, data.utf8.count <= 20_000_000 else { throw RecorderError.message("내보내기 파일 형식 또는 크기가 올바르지 않습니다.") }
                guard let presenter = self.bridge?.viewController else { throw RecorderError.message("공유 화면을 열 수 없습니다.") }
                guard UIApplication.shared.applicationState == .active, presenter.viewIfLoaded?.window != nil,
                      presenter.presentedViewController == nil else { throw RecorderError.message("앱 화면으로 돌아온 뒤 공유를 다시 시도하세요.") }
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent("yorun-share-" + UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
                let target = directory.appendingPathComponent(name)
                try Data(data.utf8).write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                let sheet = UIActivityViewController(activityItems: [target], applicationActivities: nil)
                if let popover = sheet.popoverPresentationController { popover.sourceView = presenter.view; popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1) }
                sheet.completionWithItemsHandler = { _, _, _, error in
                    self.sharing = false
                    try? FileManager.default.removeItem(at: directory)
                    if let error { call.reject(error.localizedDescription) } else { call.resolve() }
                }
                self.sharing = true
                presenter.present(sheet, animated: true)
            } catch { call.reject(error.localizedDescription) }
        }
    }
}
