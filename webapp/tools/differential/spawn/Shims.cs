// Stand-ins for what the extracted monster-selection methods reach for: the
// content monsters, the quest's own components, the board, and the random
// source. The two methods under test are compiled from the real Quest.cs.

using System;
using System.Collections.Generic;

public static class Trace
{
    public static List<string> Lines = new List<string>();
    public static void Add(string line) { Lines.Add(line); }
    public static void Reset() { Lines = new List<string>(); }
}

namespace UnityEngine
{
    public static class Random
    {
        public static List<int> Script = new List<int>();
        public static int Cursor = 0;

        public static int Range(int min, int max)
        {
            int span = max - min;
            int value = Cursor < Script.Count ? Script[Cursor] : 0;
            Cursor++;
            if (span <= 0) return min;
            Trace.Add("random(" + span + ")=" + (min + (value % span)));
            return min + (value % span);
        }
    }
}

namespace ValkyrieTools
{
    public static class ValkyrieDebug
    {
        public static void Log(object message) { Trace.Add("debug:" + message); }
    }
}

namespace Assets.Scripts.Content
{
    public class StringKey
    {
        public string key;
        public StringKey(string dict, string k, bool translate = true) { key = k ?? ""; }
    }
}

public class GenericData
{
    public string sectionName = "";
    public string[] traits = new string[0];

    public bool ContainsTrait(string trait)
    {
        foreach (string s in traits) if (trait.Equals(s)) return true;
        return false;
    }
}

public class MonsterData : GenericData { }

public static class QuestData
{
    public class QuestComponent
    {
        public string sectionName = "";
    }

    public class Spawn : QuestComponent
    {
        public string[] mTypes = new string[0];
        public string[] mTraitsRequired = new string[0];
        public string[] mTraitsPool = new string[0];
    }

    public class CustomMonster : QuestComponent
    {
        public string[] traits = new string[0];
        public string baseMonster = "";
    }
}

public class QuestDataHolder
{
    // Insertion-ordered, as a C# Dictionary is in practice for these sizes and
    // as the selection order depends on.
    public Dictionary<string, QuestData.QuestComponent> components =
        new Dictionary<string, QuestData.QuestComponent>();
}

public class ContentData
{
    public Dictionary<string, MonsterData> monsters = new Dictionary<string, MonsterData>();

    public bool ContainsKey<T>(string name) { return monsters.ContainsKey(name); }

    public Dictionary<string, T> GetAll<T>() where T : class
    {
        var result = new Dictionary<string, T>();
        foreach (var kv in monsters) result[kv.Key] = kv.Value as T;
        return result;
    }

    public bool TryGet(string name, out MonsterData data) { return monsters.TryGetValue(name, out data); }
}

public class GameType
{
    public string Name = "MoM";
    public string TypeName() { return Name; }
}

public class Game
{
    public ContentData cd = new ContentData();
    public GameType gameType = new GameType();
    public Quest CurrentQuest;

    private static Game instance = new Game();
    public static Game Get() { return instance; }
    public static Game Fresh() { instance = new Game(); return instance; }
}
