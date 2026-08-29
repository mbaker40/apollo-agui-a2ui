import XCTest
@testable import ChatCore

final class InvalidationBusTests: XCTestCase {
    func testScreensReceiveOnlyChangesForTheirScopes() async {
        let bus = InvalidationBus()
        let taskStream = await bus.subscribe(scopes: ["tasks"])
        let settingsStream = await bus.subscribe(scopes: ["settings"])
        var taskIterator = taskStream.makeAsyncIterator()
        var settingsIterator = settingsStream.makeAsyncIterator()

        let taskChange = EntityChanged(typename: "Task", id: "task_0001", kind: .created, scope: "tasks")
        let otherChange = EntityChanged(typename: "Setting", id: "s1", kind: .updated, scope: "settings")
        await bus.publish(taskChange)
        await bus.publish(otherChange)

        // Each screen sees only its own scope — the task screen's next element
        // is the task change, not the settings change, and vice versa.
        let receivedTask = await taskIterator.next()
        let receivedSettings = await settingsIterator.next()
        XCTAssertEqual(receivedTask, taskChange)
        XCTAssertEqual(receivedSettings, otherChange)
    }
}
