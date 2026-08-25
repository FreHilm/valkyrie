// Stand-ins for what the extracted attack-selection methods reach for: the
// content list, the monster's traits and the random source. No ported logic
// here — the four methods under test are compiled from the real sources.

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
    /// Replays a scripted sequence so both implementations see the same draws.
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
        public string fullKey;
        public static StringKey NULL = new StringKey(null, "", false);

        public StringKey(string dict, string k, bool translate = true)
        {
            key = k ?? "";
            fullKey = key;
        }

        public string Translate(bool quoted = false) { return key; }
    }
}

public class GenericData
{
    public string sectionName = "";
    public string[] traits = new string[0];

    // ContainsTrait as it stands in ContentTypes.cs:623.
    public bool ContainsTrait(string trait)
    {
        foreach (string s in traits)
        {
            if (trait.Equals(s)) return true;
        }
        return false;
    }
}

public class AttackData : GenericData
{
    public Assets.Scripts.Content.StringKey text = Assets.Scripts.Content.StringKey.NULL;
    public string target = "";
    public string attackType = "";
}

public class CustomMonsterStub
{
    public Dictionary<string, List<Assets.Scripts.Content.StringKey>> investigatorAttacks =
        new Dictionary<string, List<Assets.Scripts.Content.StringKey>>();
}

public class ContentData
{
    public List<AttackData> attacks = new List<AttackData>();

    public IEnumerable<T> Values<T>() where T : class
    {
        foreach (AttackData a in attacks) yield return a as T;
    }
}

public class Game
{
    public ContentData cd = new ContentData();

    private static Game instance = new Game();
    public static Game Get() { return instance; }
    public static Game Fresh() { instance = new Game(); return instance; }
}
