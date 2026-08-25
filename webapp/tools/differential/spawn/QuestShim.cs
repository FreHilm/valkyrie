// The half of Quest the extracted methods lean on. The methods themselves come
// from the real source; this only holds the state they read and write.

using System.Collections.Generic;

public partial class Quest
{
    public Game game = Game.Get();
    public QuestDataHolder qd = new QuestDataHolder();
    public Dictionary<string, string> monsterSelect = new Dictionary<string, string>();
    public List<Monster> monsters = new List<Monster>();
    public QuestLog log = new QuestLog();

    public class Monster
    {
        public MonsterData monsterData;
    }

    public class LogEntry
    {
        public string entry;
        public bool editor;
        public LogEntry(string e, bool ed = false) { entry = e; editor = ed; }
    }

    public class QuestLog
    {
        public List<LogEntry> Entries = new List<LogEntry>();
        public void Add(LogEntry e) { Entries.Add(e); Trace.Add("log:" + e.entry); }
    }
}
