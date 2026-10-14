using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Speech.Synthesis;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

// All UI Automation calls run on a dedicated MTA worker. The mouse hook only
// queues a debounced request; it never blocks user input on an accessibility call.
internal static class SelectionHelper {
    private const int WH_MOUSE_LL = 14, WM_LBUTTONDOWN = 0x0201, WM_LBUTTONUP = 0x0202;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly object OutputLock = new object();
    private static readonly BlockingCollection<Request> Queue = new BlockingCollection<Request>(1);
    private static readonly HookProc HookCallback = MouseHook;
    private static readonly Regex Word = new Regex("^[a-zA-Z]+(?:['-][a-zA-Z]+)*$", RegexOptions.CultureInvariant);
    private static volatile bool Enabled;
    private static int OwnerPid;
    private static bool Diagnostics;
    private static IntPtr Hook;
    private static System.Threading.Timer Debounce;
    private static ApplicationContext Context;
    private static Control Dispatcher;
    private static Point DownPoint, LastUpPoint;
    private static uint LastUpTime;
    private static bool HasDown;
    private sealed class Request { public string Id; public bool Explicit; public int X; public int Y; public IntPtr Foreground; }

    [STAThread]
    private static void Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        if (args.Length > 0 && args[0] == "--fixture") { Fixture(); return; }
        if (args.Length == 3 && args[0] == "--test-browser") { TestBrowserClick(int.Parse(args[1]), int.Parse(args[2])); return; }
        if (args.Length > 0) int.TryParse(args[0], out OwnerPid);
        Diagnostics = Array.IndexOf(args, "--diagnostic") >= 0;
        Context = new ApplicationContext();
        Dispatcher = new Control();
        var handle = Dispatcher.Handle;
        var worker = new Thread(ReadRequests) { IsBackground = true };
        worker.SetApartmentState(ApartmentState.MTA);
        worker.Start();
        var input = new Thread(ReadCommands) { IsBackground = true };
        input.Start();
        using (var process = Process.GetCurrentProcess())
        using (var module = process.MainModule)
            Hook = SetWindowsHookEx(WH_MOUSE_LL, HookCallback, GetModuleHandle(module.ModuleName), 0);
        Write(new { type = "ready", automatic = Hook != IntPtr.Zero });
        Application.Run(Context);
        Enabled = false;
        if (Hook != IntPtr.Zero) UnhookWindowsHookEx(Hook);
        if (Debounce != null) Debounce.Dispose();
        Queue.CompleteAdding();
        Dispatcher.Dispose();
    }
    private static void ReadCommands() {
        try {
            string line;
            while ((line = Console.ReadLine()) != null) {
                if (line.Length > 512) continue;
                var command = Json.Deserialize<Dictionary<string, object>>(line);
                var type = command.ContainsKey("type") ? command["type"] as string : null;
                if (type == "enabled") Enabled = command.ContainsKey("value") && command["value"] is bool && (bool)command["value"];
                else if (type == "capture") {
                    Point point; GetCursorPos(out point);
                    Enqueue(new Request { Id = command.ContainsKey("id") ? command["id"] as string : "manual", Explicit = true, X = point.X, Y = point.Y, Foreground = GetForegroundWindow() });
                } else if (type == "speak" && command.ContainsKey("word")) {
                    var spoken = command["word"] as string;
                    if (spoken != null && spoken.Length <= 64 && Word.IsMatch(spoken)) ThreadPool.QueueUserWorkItem(_ => {
                        try {
                            using (var voice = new SpeechSynthesizer()) {
                                try { voice.SelectVoiceByHints(VoiceGender.NotSet, VoiceAge.NotSet, 0, new System.Globalization.CultureInfo("en-GB")); } catch { }
                                voice.Speak(spoken);
                            }
                        } catch { }
                    });
                } else if (type == "quit") break;
            }
        } catch { /* Malformed input ends this isolated helper, not Electron. */ }
        try { Dispatcher.BeginInvoke(new Action(() => Context.ExitThread())); } catch { }
    }
    private static IntPtr MouseHook(int code, IntPtr message, IntPtr data) {
        if (code >= 0 && (message.ToInt32() == WM_LBUTTONDOWN || message.ToInt32() == WM_LBUTTONUP)) {
            var info = (MouseInfo)Marshal.PtrToStructure(data, typeof(MouseInfo));
            if (message.ToInt32() == WM_LBUTTONDOWN) { DownPoint = info.Point; HasDown = true; }
            else {
                var dragged = HasDown && (Math.Abs(info.Point.X - DownPoint.X) >= 3 || Math.Abs(info.Point.Y - DownPoint.Y) >= 3);
                var doubleClick = LastUpTime != 0 && unchecked(info.Time - LastUpTime) <= GetDoubleClickTime() && Math.Abs(info.Point.X - LastUpPoint.X) < GetSystemMetrics(36) && Math.Abs(info.Point.Y - LastUpPoint.Y) < GetSystemMetrics(37);
                LastUpTime = info.Time; LastUpPoint = info.Point; HasDown = false;
                if (Enabled && (dragged || doubleClick)) {
                    var request = new Request { Id = Guid.NewGuid().ToString("N"), X = info.Point.X, Y = info.Point.Y, Foreground = GetForegroundWindow() };
                    if (Debounce != null) Debounce.Dispose();
                    Debounce = new System.Threading.Timer(_ => { if (Enabled) Enqueue(request); }, null, 180, Timeout.Infinite);
                }
            }
        }
        return CallNextHookEx(Hook, code, message, data);
    }
    private static void Enqueue(Request request) {
        try { Queue.TryAdd(request); } catch (InvalidOperationException) { }
    }
    private static void ReadRequests() {
        foreach (var request in Queue.GetConsumingEnumerable()) {
            if (!request.Explicit && !Enabled) continue;
            Write(new { type = "reading", id = request.Id, explicitAction = request.Explicit });
            string word = null;
            bool protectedField = false;
            try {
                uint pid; GetWindowThreadProcessId(request.Foreground, out pid);
                if (pid != 0 && pid != OwnerPid && request.Foreground == GetForegroundWindow()) {
                    var focused = AutomationElement.FocusedElement;
                    if (Diagnostics) Write(new { type = "diagnostic", focusedType = focused == null ? "none" : focused.Current.ControlType.ProgrammaticName, process = pid, sameForeground = request.Foreground == GetForegroundWindow() });
                    protectedField = Protected(focused);
                    if (!protectedField) {
                        word = FromAncestors(focused, pid);
                        if (word == null) word = FromAncestors(AutomationElement.FromPoint(new System.Windows.Point(request.X, request.Y)), pid);
                        if (word == null) {
                            // Some Chromium pages expose selection on the Document,
                            // not the focused link. Bounded traversal never reads values.
                            var root = AutomationElement.FromHandle(request.Foreground);
                            var documents = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
                            for (int i = 0; i < Math.Min(documents.Count, 30) && word == null; i++) word = SelectedWord(documents[i]);
                        }
                    }
                }
            } catch (Exception error) { if (Diagnostics) Write(new { type = "diagnostic", error = error.GetType().Name }); }
            if (word != null && (request.Explicit || Enabled)) Write(new { type = "selection", word = word, explicitAction = request.Explicit });
            Write(new { type = "done", id = request.Id, found = word != null, explicitAction = request.Explicit, protectedField = protectedField });
        }
    }
    private static bool Protected(AutomationElement element) {
        for (int i = 0; element != null && i < 10; i++) {
            if (element.Current.IsPassword) return true;
            element = TreeWalker.ControlViewWalker.GetParent(element);
        }
        return false;
    }
    private static string FromAncestors(AutomationElement element, uint pid) {
        for (int i = 0; element != null && i < 12; i++) {
            if (element.Current.ProcessId != pid || element.Current.IsPassword) return null;
            var word = SelectedWord(element);
            if (word != null) return word;
            element = TreeWalker.ControlViewWalker.GetParent(element);
        }
        return null;
    }
    private static string SelectedWord(AutomationElement element) {
        if (element == null || Protected(element)) return null;
        object pattern;
        if (!element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) { if (Diagnostics) Write(new { type = "diagnostic", pattern = false, controlType = element.Current.ControlType.ProgrammaticName }); return null; }
        var ranges = ((TextPattern)pattern).GetSelection();
        if (Diagnostics) Write(new { type = "diagnostic", pattern = true, ranges = ranges.Length });
        if (ranges.Length != 1) return null;
        // Never serialize unvalidated text, including empty carets and phrases.
        string text = ranges[0].GetText(66).Trim().Replace('\u2019', '\'').Replace('\u2018', '\'');
        if (Diagnostics) Write(new { type = "diagnostic", selectedLength = text.Length, valid = text.Length <= 64 && Word.IsMatch(text) });
        return text.Length > 0 && text.Length <= 64 && Word.IsMatch(text) ? text.ToLowerInvariant() : null;
    }
    private static void Write(object value) { lock (OutputLock) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); } }

    private static void TestBrowserClick(int x, int y) {
        IntPtr target = IntPtr.Zero;
        EnumWindows((hwnd, unused) => {
            var title = new StringBuilder(300); GetWindowText(hwnd, title, title.Capacity);
            if (title.ToString().StartsWith("English Buddy Browser Fixture")) { target = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        if (target == IntPtr.Zero) { Write(new { type = "test-error", reason = "fixture-not-found" }); return; }
        ShowWindow(target, 9); SetWindowPos(target, new IntPtr(-1), 0, 0, 0, 0, 0x13); SetForegroundWindow(target); Thread.Sleep(300);
        var documents = AutomationElement.FromHandle(target).FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
        System.Windows.Rect documentBounds = System.Windows.Rect.Empty;
        for (int i = 0; i < documents.Count; i++) {
            if (documents[i].Current.Name.StartsWith("English Buddy Browser Fixture")) { documentBounds = documents[i].Current.BoundingRectangle; break; }
        }
        if (documentBounds.IsEmpty && documents.Count == 1) documentBounds = documents[0].Current.BoundingRectangle;
        if (documentBounds.IsEmpty) {
            // Locate this fixture's web viewport even before Chromium has
            // activated its accessibility tree. This is test input, not OCR.
            EnumChildWindows(target, (hwnd, unused) => {
                var className = new StringBuilder(128); GetClassName(hwnd, className, className.Capacity);
                Rect childBounds; GetWindowRect(hwnd, out childBounds);
                if (className.ToString() == "Chrome_RenderWidgetHostHWND" && IsWindowVisible(hwnd) && childBounds.Right - childBounds.Left > 300 && childBounds.Bottom - childBounds.Top > 200) {
                    documentBounds = new System.Windows.Rect(childBounds.Left, childBounds.Top, childBounds.Right - childBounds.Left, childBounds.Bottom - childBounds.Top); return false;
                }
                return true;
            }, IntPtr.Zero);
        }
        if (documentBounds.IsEmpty) { SetWindowPos(target, new IntPtr(-2), 0, 0, 0, 0, 0x13); Write(new { type = "test-error", reason = "document-unavailable", documentCount = documents.Count }); return; }
        x += (int)Math.Round(documentBounds.X); y += (int)Math.Round(documentBounds.Y);
        Rect bounds; GetWindowRect(target, out bounds);
        if (x < bounds.Left || x >= bounds.Right || y < bounds.Top || y >= bounds.Bottom) { Write(new { type = "test-error", reason = "point-outside-fixture" }); return; }
        ShowWindow(target, 9); SetWindowPos(target, new IntPtr(-1), 0, 0, 0, 0, 0x13); SetForegroundWindow(target); Thread.Sleep(200);
        if (GetAncestor(WindowFromPoint(new Point { X = x, Y = y }), 2) != target) {
            SetWindowPos(target, new IntPtr(-2), 0, 0, 0, 0, 0x13);
            Write(new { type = "test-error", reason = "fixture-covered" }); return;
        }
        Point previous; GetCursorPos(out previous);
        SetCursorPos(x, y);
        mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(70);
        mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(300); SetCursorPos(previous.X, previous.Y);
        SetWindowPos(target, new IntPtr(-2), 0, 0, 0, 0, 0x13);
        Write(new { type = "test-clicked" });
    }

    // A real accessible Windows test surface. Used only by desktop verification.
    private static void Fixture() {
        var form = new Form { Text = "English Buddy UIA Fixture", Width = 640, Height = 320, TopMost = true, StartPosition = FormStartPosition.CenterScreen };
        var text = new RichTextBox { Text = "consistent", Dock = DockStyle.Top, Height = 150, Font = new System.Drawing.Font("Segoe UI", 20) };
        var password = new TextBox { Text = "private", UseSystemPasswordChar = true, Dock = DockStyle.Bottom };
        form.Controls.Add(text); form.Controls.Add(password);
        form.Shown += (sender, e) => { text.Focus(); text.SelectAll(); Write(new { type = "fixture", hwnd = form.Handle.ToInt64() }); };
        new Thread(() => {
            string command;
            while ((command = Console.ReadLine()) != null) {
                var action = command;
                try { form.BeginInvoke(new Action(() => {
                    Write(new { type = "fixture-action", action = action, visible = form.Visible, foreground = GetForegroundWindow() == form.Handle });
                    if (action == "quit") { form.Close(); return; }
                    form.BringToFront(); form.Activate(); SetForegroundWindow(form.Handle);
                    if (action == "password") { password.Focus(); password.SelectAll(); }
                    else { text.Focus(); text.SelectAll(); }
                    if (action == "auto") {
                        text.Select(0, 0);
                        var point = text.PointToScreen(new System.Drawing.Point(60, 18));
                        if (GetAncestor(WindowFromPoint(new Point { X = point.X, Y = point.Y }), 2) != form.Handle) { Write(new { type = "fixture-error", reason = "fixture-covered" }); return; }
                        SetCursorPos(point.X, point.Y);
                        mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
                        mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
                    } else if (action == "shortcut" || action == "password") {
                        if (GetForegroundWindow() != form.Handle) { Write(new { type = "fixture-error", reason = "foreground" }); return; }
                        keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(0x10, 0, 0, UIntPtr.Zero); keybd_event(0x45, 0, 0, UIntPtr.Zero);
                        keybd_event(0x45, 0, 2, UIntPtr.Zero); keybd_event(0x10, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero);
                    }
                })); } catch { break; }
            }
        }) { IsBackground = true }.Start();
        Application.Run(form);
    }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInfo { public Point Point; public uint MouseData; public uint Flags; public uint Time; public IntPtr Extra; }
    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int hook, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    private delegate bool WindowCallback(IntPtr hwnd, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rectangle);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int show);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int metric);
}
