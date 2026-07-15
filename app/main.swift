// vibedeck.app — native shell for the vibedeck board.
// A WKWebView window + a menu-bar badge with the needs-you count.
// If the local server isn't up, it starts the launchd service and retries.
import Cocoa
import WebKit

let PORT = ProcessInfo.processInfo.environment["VIBEDECK_PORT"] ?? "8423"
let BOARD = URL(string: "http://127.0.0.1:\(PORT)/")!

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var statusItem: NSStatusItem!
    var retryTimer: Timer?

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        buildWindow()
        buildStatusItem()
        load()
        Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { _ in self.refreshBadge() }
        refreshBadge()
    }

    // ---------- window ----------
    func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1320, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "vibedeck"
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(red: 0.043, green: 0.055, blue: 0.086, alpha: 1)
        window.minSize = NSSize(width: 720, height: 500)
        window.center()
        window.setFrameAutosaveName("vibedeck-main")
        window.isReleasedWhenClosed = false

        let conf = WKWebViewConfiguration()
        conf.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = WKWebView(frame: window.contentView!.bounds, configuration: conf)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        window.contentView!.addSubview(webView)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func load() { webView.load(URLRequest(url: BOARD, timeoutInterval: 4)) }

    func webView(_ wv: WKWebView, didFail navigation: WKNavigation!, withError e: Error) { serverDown() }
    func webView(_ wv: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError e: Error) { serverDown() }

    // Server not answering: nudge launchd (kickstart loads-or-restarts), retry shortly.
    func serverDown() {
        let uid = getuid()
        let t = Process()
        t.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        t.arguments = ["kickstart", "gui/\(uid)/com.vibedeck"]
        try? t.run()
        webView.loadHTMLString("""
            <body style="background:#0b0e16;color:#9aa0b4;font:15px -apple-system;display:flex;
            align-items:center;justify-content:center;height:100vh;margin:0">
            <div style="text-align:center"><div style="font:italic 22px ui-serif">vibedeck</div>
            <p>waking the deck server…</p></div></body>
            """, baseURL: nil)
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: false) { _ in self.load() }
    }

    // ---------- menu-bar badge ----------
    func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "▤"
        statusItem.button?.action = #selector(statusClicked)
        statusItem.button?.target = self
    }

    @objc func statusClicked() {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        webView.reload()
    }

    func refreshBadge() {
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(PORT)/api/sessions")!, timeoutInterval: 5)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: req) { data, _, _ in
            var needs = 0, working = 0
            if let data,
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let active = obj["active"] as? [[String: Any]] {
                for c in active {
                    let state = c["state"] as? String ?? ""
                    let asks = c["asks"] as? String
                    if state == "needs-input" || (asks != nil && state != "working") { needs += 1 }
                    else if state == "working" { working += 1 }
                }
            }
            DispatchQueue.main.async {
                guard let btn = self.statusItem.button else { return }
                if needs > 0 {
                    btn.attributedTitle = NSAttributedString(
                        string: "▤ \(needs)",
                        attributes: [.foregroundColor: NSColor(red: 0.91, green: 0.66, blue: 0.32, alpha: 1),
                                     .font: NSFont.systemFont(ofSize: 13, weight: .semibold)])
                } else {
                    btn.attributedTitle = NSAttributedString(string: working > 0 ? "▤ ·" : "▤",
                        attributes: [.font: NSFont.systemFont(ofSize: 13)])
                }
                btn.toolTip = "\(needs) need you · \(working) working"
            }
        }.resume()
    }

    // ---------- app behaviour ----------
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    @objc func reloadPage() { webView.reload() }

    // Standard menus so copy/paste works inside the board (the wish box needs it).
    func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About vibedeck", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide vibedeck", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit vibedeck", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
        viewItem.submenu = view

        let windowItem = NSMenuItem(); main.addItem(windowItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = win

        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
