// Stand-ins for what the extracted ActivationInstance and OutputSymbolReplace
// reach for: the game type, the quest's variables, and a random hero. No
// ported logic here — these exist so the real sources compile and so the
// harness can drive them deterministically.

using System.Collections.Generic;
using Assets.Scripts.Content;

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

public class GameType
{
    public virtual string TypeName() { return "D2E"; }
}

public class MoMGameType : GameType
{
    public override string TypeName() { return "MoM"; }
}

public class D2EGameType : GameType { }

public class ActivationData
{
    public string sectionName = "";
    public StringKey ability = StringKey.NULL;
    public StringKey minionActions = StringKey.NULL;
    public StringKey masterActions = StringKey.NULL;
    public StringKey moveButton = StringKey.NULL;
    public StringKey move = StringKey.NULL;
}

public class HeroData
{
    public StringKey name = StringKey.NULL;
}

public class QuestVars
{
    public Dictionary<string, float> Values = new Dictionary<string, float>();
    public float GetValue(string name)
    {
        return Values.TryGetValue(name, out float v) ? v : 0f;
    }
}

public class LogEntryStub
{
    public LogEntryStub(string text, bool editor) { Text = text; Editor = editor; }
    public string Text;
    public bool Editor;
}

public class QuestLogStub
{
    public List<LogEntryStub> Entries = new List<LogEntryStub>();
    public void Add(LogEntryStub entry) { Entries.Add(entry); }
}

public class HeroStub
{
    public HeroData heroData = new HeroData();
}

public class CurrentQuestStub
{
    public QuestVars vars = new QuestVars();
    public QuestLogStub log = new QuestLogStub();
    public HeroStub RandomHero = new HeroStub();
    public HeroStub GetRandomHero() { return RandomHero; }
}

// The extracted OutputSymbolReplace writes `new Quest.LogEntry(...)`, and the
// extracted ActivationInstance is nested inside `Quest`, so the two share it.
public partial class Quest
{
    public class LogEntry : LogEntryStub
    {
        public LogEntry(string text, bool editor = false) : base(text, editor) { }
    }
}

public class Game
{
    public GameType gameType = new MoMGameType();
    public CurrentQuestStub CurrentQuest = new CurrentQuestStub();
    public string currentLang = "English";
    public string fallbackLang = "English";

    private static Game instance = new Game();
    public static Game Get() { return instance; }
    public static Game Fresh() { instance = new Game(); return instance; }
}
