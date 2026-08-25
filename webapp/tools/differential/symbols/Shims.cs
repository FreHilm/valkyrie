// Stand-ins for the two things the extracted code reaches for: the game type
// and the current quest's variables. Both are set per case by the harness.
using System.Collections.Generic;

public class GameType
{
    public string Name = "MoM";
    public string TypeName() { return Name; }
}

public class QuestVars
{
    public Dictionary<string, float> Values = new Dictionary<string, float>();
    public float GetValue(string name)
    {
        // VarManager returns 0 for anything unset.
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

public class CurrentQuestStub
{
    public QuestVars vars = new QuestVars();
    public QuestLogStub log = new QuestLogStub();
}

public class Game
{
    public GameType gameType = new GameType();
    public CurrentQuestStub CurrentQuest = new CurrentQuestStub();
    private static Game instance = new Game();
    public static Game Get() { return instance; }
    public static void Reset() { instance = new Game(); }
}

// The extracted code writes `new Quest.LogEntry(...)`.
public static class Quest
{
    public class LogEntry : LogEntryStub
    {
        public LogEntry(string text, bool editor) : base(text, editor) { }
    }
}
