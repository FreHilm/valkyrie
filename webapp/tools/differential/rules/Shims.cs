// Stand-ins for the Unity and game-runtime dependencies of VarManager and the
// puzzles. No ported logic here — these exist only so the real sources compile.
//
// Random.Range is deterministic and driven by the harness, so generation can be
// compared step for step against the TypeScript port.

using System;
using System.Collections.Generic;

namespace UnityEngine
{
    public static class Debug
    {
        public static void Log(object message) { }
    }

    public class Object { }

    public enum RuntimePlatform { WindowsPlayer, OSXPlayer, LinuxPlayer, Android }

    public struct Vector2
    {
        public float x, y;
        public Vector2(float x, float y) { this.x = x; this.y = y; }
        public static Vector2 zero { get { return new Vector2(0, 0); } }
    }

    public static class Application
    {
        public static RuntimePlatform platform = RuntimePlatform.OSXPlayer;
        public static void Quit() { throw new HarnessQuitException(); }
    }

    public class HarnessQuitException : Exception { }

    public class TextAsset
    {
        public string text;
        public TextAsset(string t) { text = t; }
    }

    public static class Resources
    {
        public static string SlidePuzzleText = "";
        public static object Load(string name)
        {
            return new TextAsset(SlidePuzzleText);
        }
    }

    /// <summary>
    /// Replays a script of values supplied by the harness, so the TypeScript
    /// port can be fed exactly the same sequence.
    /// </summary>
    public static class Random
    {
        public static List<int> Script = new List<int>();
        public static int Cursor = 0;
        public static List<string> Calls = new List<string>();

        public static int Range(int minInclusive, int maxExclusive)
        {
            Calls.Add(minInclusive + "," + maxExclusive);
            int value = Cursor < Script.Count ? Script[Cursor] : minInclusive;
            Cursor++;
            // Keep the value inside the requested range, as Unity would.
            if (maxExclusive <= minInclusive) return minInclusive;
            int span = maxExclusive - minInclusive;
            return minInclusive + ((value % span) + span) % span;
        }
    }
}

namespace ValkyrieTools
{
    public class ValkyrieDebug
    {
        public static bool enabled { get; set; } = false;
        public static List<string> Messages = new List<string>();
        public static void Log(object message) { Messages.Add(message?.ToString()); }
        public static void Log(object message, UnityEngine.Object context) { }
    }
}

// VarManager writes notices through Game.Get().CurrentQuest.log.
public class Quest
{
    public class LogEntry
    {
        public string content;
        public bool valkyrie;
        public LogEntry(string c, bool v) { content = c; valkyrie = v; }
    }

    public class QuestLog
    {
        public List<LogEntry> entries = new List<LogEntry>();
        public void Add(LogEntry e) { entries.Add(e); }
    }

    public QuestLog log = new QuestLog();
}

public static class HTTPManager
{
    public static void Get(string url, Action<string, bool, Uri> action) { }
}

public class Game
{
    public Quest CurrentQuest = new Quest();

    private static Game instance = new Game();
    public static Game Get() { return instance; }
    public static void Reset() { instance = new Game(); }
}
