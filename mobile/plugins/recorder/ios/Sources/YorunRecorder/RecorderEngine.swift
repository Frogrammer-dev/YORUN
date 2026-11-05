import Foundation
import CoreLocation
import UIKit

/// Process lifetime singleton: the native recorder survives WebView suspension/reload.
final class RecorderEngine: NSObject, CLLocationManagerDelegate {
    static let shared = RecorderEngine()
    private let manager = CLLocationManager()
    private var journal: NativeJournal?
    private var initializationError: Error?
    private var pending: (action: String, completion: (Error?) -> Void)?
    private(set) var nativeError: String?

    private override init() {
        super.init()
        do { journal = try NativeJournal() } catch { initializationError = error }
        do { try journal?.recover() }
        catch { nativeError = "위치 기록을 저장하지 못해 기록을 중단했습니다. 저장 공간을 확인하고 앱을 다시 여세요." }
        manager.delegate = self
        manager.activityType = .fitness
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 3
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
        let backgroundModes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        let explanation = Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") as? String ?? ""
        if backgroundModes.contains("location") && !explanation.isEmpty {
            manager.allowsBackgroundLocationUpdates = true
        } else {
            initializationError = RecorderError.message("앱의 위치 권한 설명과 백그라운드 위치 설정이 누락되었습니다. 앱 빌드 설정을 확인하세요.")
        }
    }
    private func store() throws -> NativeJournal {
        if let initializationError { throw initializationError }
        guard let journal else { throw RecorderError.message("러닝 저장소를 열 수 없습니다.") }
        return journal
    }
    func snapshot(_ id: String?) throws -> [String: Any] {
        var result = try store().snapshot(id)
        if let nativeError, id == nil || id == journal?.id {
            result["nativeError"] = nativeError
            // If disk writes failed, expose an in-memory interruption as well.
            // The UI must never continue a running clock after native capture stops.
            if journal?.status == "running", let journal {
                var events = result["events"] as? [[String: Any]] ?? []
                events.append(journal.interruption(nativeError))
                result["events"] = events
            }
        }
        return result
    }
    func list() throws -> [String: Any] { try store().list() }
    func command(_ action: String, completion: @escaping (Error?) -> Void) {
        guard pending == nil else { completion(RecorderError.message("위치 권한 요청을 먼저 완료하세요.")); return }
        // Reject caller mistakes before touching a running location manager.
        do { try store().validate(action) } catch { completion(error); return }
        if action == "start" || action == "resume" {
            guard UIApplication.shared.applicationState != .background else {
                completion(RecorderError.message("앱을 화면에 연 상태에서 러닝을 시작하거나 재개하세요.")); return
            }
            guard CLLocationManager.locationServicesEnabled() else { completion(RecorderError.message("설정에서 위치 서비스를 켜주세요.")); return }
            if manager.authorizationStatus == .notDetermined {
                pending = (action, completion); manager.requestWhenInUseAuthorization(); return
            }
            guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else {
                completion(RecorderError.message("설정 > 요런 러닝 기록 > 위치에서 앱을 사용하는 동안과 정확한 위치를 허용해주세요.")); return
            }
            guard manager.accuracyAuthorization == .fullAccuracy else { completion(RecorderError.message("러닝 경로 기록에는 정확한 위치가 필요합니다. 설정에서 정확한 위치를 켜주세요.")); return }
        }
        do {
            let journal = try store()
            try journal.command(action)
            if action == "start" || action == "resume" { nativeError = nil; manager.startUpdatingLocation() }
            else { manager.stopUpdatingLocation() }
            completion(nil)
        } catch {
            let reason = "위치 기록을 저장하지 못해 기록을 중단했습니다. 저장 공간을 확인하고 앱을 다시 여세요."
            fail(reason)
            completion(RecorderError.message(reason))
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if let waiting = pending, manager.authorizationStatus != .notDetermined {
            pending = nil; command(waiting.action, completion: waiting.completion)
        } else if journal?.status == "running" && (manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted || manager.accuracyAuthorization != .fullAccuracy) {
            fail("위치 권한이 변경되어 기록이 중단되었습니다. 권한을 확인한 뒤 재개하세요.")
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard journal?.status == "running", nativeError == nil else { return }
        do {
            for location in locations {
                guard CLLocationCoordinate2DIsValid(location.coordinate), location.horizontalAccuracy.isFinite,
                      location.timestamp.timeIntervalSince1970.isFinite else { continue }
                try store().point(location)
            }
        } catch { fail("위치 기록을 저장하지 못해 기록을 중단했습니다. 저장 공간을 확인하고 앱을 다시 여세요.") }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard journal?.status == "running", nativeError == nil else { return }
        if let locationError = error as? CLError, locationError.code == .locationUnknown {
            // Transient signal loss is kept as a gap, never joined into a straight line.
            return
        }
        fail("위치를 수신할 수 없어 기록이 중단되었습니다. 위치 권한을 확인한 뒤 재개하세요.")
    }
    private func fail(_ reason: String) {
        nativeError = reason
        manager.stopUpdatingLocation()
        do { try journal?.recover(reason); try journal?.error(reason) }
        catch { nativeError = "위치 기록을 저장하지 못해 기록을 중단했습니다. 저장 공간을 확인하고 앱을 다시 여세요." }
    }
}
