// Minimal stand-ins for the Unity-side dependencies of the three ported files.
// None of them contain ported logic; they exist so the real sources compile.
namespace UnityEngine
{
    public static class Debug
    {
        public static void Log(object message) { }
        public static void Log(object message, object context) { }
    }
    public class Object { }
}

namespace ValkyrieTools
{
    public class ValkyrieDebug
    {
        public static bool enabled { get; set; } = false;
        public static void Log(object message) { }
        public static void Log(object message, UnityEngine.Object context) { }
    }
}

public static class ValkyrieConstants
{
    public const string DefaultLanguage = "English";
}

// DictionaryI18n.InitCurrentLanguage calls Game.Get(); returning null takes the
// deterministic branch (English / no fallback).
public class Game
{
    public string currentLang = "English";
    public string fallbackLang = "";
    public static Game Get() { return null; }
}
