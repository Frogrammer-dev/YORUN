import Foundation
import CoreLocation

enum RecorderError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

/// Accessed only on the native main queue; CoreLocation writes do not need JavaScript.
final class NativeJournal {
    private let directory: URL
    private(set) var id: String?
    private(set) var status = "empty"
    private var lastDurableTime: Double = 0
    private var storageFailure: Error?
    private let fm = FileManager.default

    init() throws {
        let fm = FileManager.default
        directory = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("yorun-runs", isDirectory: true)
        try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var root = directory
        var resource = URLResourceValues(); resource.isExcludedFromBackup = true
        try root.setResourceValues(resource)
        let pointer = directory.appendingPathComponent("current-id")
        let savedIds = try names()
        let latest: String?
        if fm.fileExists(atPath: pointer.path) {
            // Treat the pointer as an index, not as the only source of truth.
            // If metadata survives while its target does not (or is malformed),
            // restore the newest remaining journal instead of locking out all runs.
            let candidate = String(decoding: try Data(contentsOf: pointer), as: UTF8.self)
            latest = savedIds.contains(candidate) ? candidate : savedIds.last
        } else {
            latest = savedIds.last
        }
        if let latest {
            id = latest
            let target = try file(latest)
            var data = try Data(contentsOf: target)
            if !data.isEmpty && data.last != 10 {
                data = data.prefix(data.lastIndex(of: 10).map { $0 + 1 } ?? 0)
                try data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                try sync(target)
            }
            for event in try events(latest) { apply(event) }
        }
    }

    private func sync(_ target: URL) throws {
        let handle = try FileHandle(forWritingTo: target)
        defer { try? handle.close() }
        try handle.synchronize()
    }

    private func valid(_ value: String) -> Bool {
        value.range(of: "^[0-9]{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", options: .regularExpression) != nil
    }
    private func file(_ value: String) throws -> URL {
        guard valid(value) else { throw RecorderError.message("잘못된 기록 ID입니다.") }
        return directory.appendingPathComponent(value + ".jsonl")
    }
    private func names() throws -> [String] {
        try fm.contentsOfDirectory(atPath: directory.path).filter { $0.hasSuffix(".jsonl") }.map { String($0.dropLast(6)) }.filter(valid).sorted()
    }
    private func events(_ value: String?) throws -> [[String: Any]] {
        guard let value else { return [] }
        let data = try Data(contentsOf: file(value))
        let text = String(decoding: data, as: UTF8.self)
        // Ignore only an incomplete last line; malformed complete records are surfaced.
        return try text.components(separatedBy: "\n").dropLast().filter { !$0.isEmpty }.map {
            guard let event = try JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] else { throw RecorderError.message("기록 파일이 손상되었습니다.") }
            return event
        }
    }
    private func apply(_ event: [String: Any]) {
        switch event["type"] as? String {
        case "start", "resume": status = "running"
        case "pause": status = "paused"
        case "stop": status = "stopped"
        case "interrupted": status = "interrupted"
        default: break
        }
        lastDurableTime = max(lastDurableTime, (event["receivedAt"] as? Double) ?? (event["time"] as? Double) ?? 0)
    }
    private func append(_ event: [String: Any]) throws {
        if let storageFailure { throw storageFailure }
        guard let id else { throw RecorderError.message("러닝이 시작되지 않았습니다.") }
        let target = try file(id)
        if !fm.fileExists(atPath: target.path) {
            guard fm.createFile(atPath: target.path, contents: Data(), attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw RecorderError.message("러닝 파일을 만들 수 없습니다.") }
        }
        var data = try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]); data.append(10)
        let handle = try FileHandle(forWritingTo: target)
        defer { try? handle.close() }
        let offset = try handle.seekToEnd()
        do {
            try handle.write(contentsOf: data)
            try handle.synchronize()
        } catch {
            // Never append after a partially written record. Relaunch reopens the
            // durable prefix; this process must report the storage failure.
            storageFailure = error
            try? handle.truncate(atOffset: offset)
            try? handle.synchronize()
            throw error
        }
        apply(event)
    }
    func recover(_ reason: String = "앱 재시작으로 기록이 중단되었습니다. 저장된 지점부터 복원했으며 재개가 필요합니다.") throws {
        if status == "running" {
            try append(interruption(reason))
        }
    }
    func interruption(_ reason: String) -> [String: Any] {
        ["type": "interrupted", "time": lastDurableTime, "reason": reason]
    }
    func validate(_ action: String) throws {
        if let storageFailure { throw storageFailure }
        switch action {
        case "start":
            guard status == "empty" || status == "stopped" else { throw RecorderError.message("진행 중인 러닝을 먼저 종료하세요.") }
        case "resume":
            guard status == "paused" || status == "interrupted" else { throw RecorderError.message("일시정지 또는 중단된 기록만 재개할 수 있습니다.") }
        case "pause":
            guard status == "running" else { throw RecorderError.message("기록 중에만 일시정지할 수 있습니다.") }
        case "stop":
            guard status != "empty" && status != "stopped" else { throw RecorderError.message("종료할 러닝이 없습니다.") }
        default: throw RecorderError.message("지원하지 않는 명령입니다.")
        }
    }
    func command(_ action: String) throws {
        try validate(action)
        if action == "start" {
            let nextId = "\(Int64(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.lowercased())"
            let target = try file(nextId)
            guard fm.createFile(atPath: target.path, contents: Data(), attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else {
                throw RecorderError.message("러닝 파일을 만들 수 없습니다.")
            }
            try sync(target)
            // The target exists and has been synced before publishing its pointer.
            // A crash before append(start) leaves a valid empty journal, which
            // restores as "empty" and does not claim an active run.
            let pointer = directory.appendingPathComponent("current-id")
            try Data(nextId.utf8).write(to: pointer, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try sync(pointer)
            id = nextId
            status = "empty"
            lastDurableTime = 0
        }
        try append(["type": action, "time": Date().timeIntervalSince1970 * 1000, "platform": "ios"])
    }
    func point(_ location: CLLocation) throws {
        guard status == "running" else { return }
        try append(["type": "point", "time": location.timestamp.timeIntervalSince1970 * 1000, "receivedAt": Date().timeIntervalSince1970 * 1000,
                    "lat": location.coordinate.latitude, "lng": location.coordinate.longitude, "accuracy": location.horizontalAccuracy])
    }
    func error(_ reason: String) throws {
        if id != nil { try append(["type": "error", "time": Date().timeIntervalSince1970 * 1000, "reason": reason]) }
    }
    func snapshot(_ requestedId: String?) throws -> [String: Any] {
        let chosen = requestedId ?? id
        return ["id": chosen.map { $0 as Any } ?? NSNull(), "events": try events(chosen), "osVersion": ProcessInfo.processInfo.operatingSystemVersionString]
    }
    func list() throws -> [String: Any] { ["records": try names().reversed().map { ["id": $0] }] }
}
