// Stand-ins for the Unity side of InvestigatorEvade.cs and HorrorCheck.cs.
//
// Both files are compiled unmodified. What is under test is the *selection*:
// which entry gets picked for a monster, what the fallback to a derived type
// does, and when nothing is drawn at all. The dialog half is stubbed to
// nothing, and every choice it would have made is traced instead.

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
    public static class Debug
    {
        public static void Log(object message) { }
    }

    public class Object
    {
        public static void Destroy(object o) { }
    }

    public class GameObject
    {
        public static GameObject[] FindGameObjectsWithTag(string tag) { return new GameObject[0]; }
    }

    public struct Color
    {
        public static Color grey { get { return new Color(); } }
        public static Color white { get { return new Color(); } }
    }

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

        // The i18n differential covers translation; here a literal is enough
        // for the substitution and logging under test.
        public string Translate(bool quoted = false) { return key; }
    }
}

namespace Assets.Scripts.UI
{
    public class UIElement
    {
        public UIElement() { }
        public UIElement(string tag) { }
        public void SetLocation(float x, float y, float w, float h) { }
        public void SetText(string t) { Trace.Add("text:" + t.Replace("\n", "\\n")); }
        public void SetText(string t, UnityEngine.Color c) { SetText(t); }
        public void SetText(Assets.Scripts.Content.StringKey k) { Trace.Add("key:" + k.key); }
        public void SetText(Assets.Scripts.Content.StringKey k, UnityEngine.Color c)
        {
            Trace.Add("key:" + k.key + ":grey");
        }
        public void SetFontSize(int size) { }
        public void SetButton(UnityEngine.Events.UnityAction call) { Trace.Add("button"); }
    }

    public class UIElementBorder
    {
        public UIElementBorder(UIElement e) { }
        public UIElementBorder(UIElement e, UnityEngine.Color c) { }
    }
}

namespace UnityEngine.Events
{
    public delegate void UnityAction();
}

public static class UIScaler
{
    public static float GetHCenter(float offset) { return offset; }
    public static float GetWidthUnits() { return 32; }
    public static int GetMediumFont() { return 1; }
}

public static class CommonStringKeys
{
    public static Assets.Scripts.Content.StringKey FINISHED =
        new Assets.Scripts.Content.StringKey("val", "FINISHED");
}

public static class Destroyer
{
    public static void Dialog() { }
}

public class GenericData
{
    public string sectionName = "";
}

public class MonsterData : GenericData
{
    public static string type = "Monster";
    public Assets.Scripts.Content.StringKey name = Assets.Scripts.Content.StringKey.NULL;
    public float healthBase = 0;
    public float healthPerHero = 0;
}

public class CustomMonsterStub
{
    public string evadeEvent = "";
    public string horrorEvent = "";
}

public class QuestMonster : MonsterData
{
    public string derivedType = "";
    public CustomMonsterStub cMonster = new CustomMonsterStub();
}

public class EvadeData : GenericData
{
    public Assets.Scripts.Content.StringKey text = Assets.Scripts.Content.StringKey.NULL;
    public string monster = "";
}

public class HorrorData : GenericData
{
    public Assets.Scripts.Content.StringKey text = Assets.Scripts.Content.StringKey.NULL;
    public string monster = "";
}

public class ContentData
{
    public List<EvadeData> evades = new List<EvadeData>();
    public List<HorrorData> horrors = new List<HorrorData>();

    public IEnumerable<T> Values<T>() where T : class
    {
        if (typeof(T) == typeof(EvadeData))
            foreach (EvadeData e in evades) yield return e as T;
        else
            foreach (HorrorData h in horrors) yield return h as T;
    }
}

public class EventManagerStub
{
    public Quest.Monster monsterImage = null;
    public void QueueEvent(string name, bool trigger = true) { Trace.Add("queue:" + name); }
}

public class QuestDataHolder
{
    public Dictionary<string, object> components = new Dictionary<string, object>();
}

public class Quest
{
    public class Monster
    {
        public MonsterData monsterData = null;
        public string id = "";
        public int damage = 0;
        public int healthMod = 0;

        public int GetHealth()
        {
            return (int)System.Math.Round(
                (double)(monsterData.healthBase +
                         Game.Get().CurrentQuest.GetHeroCount() * monsterData.healthPerHero)) + healthMod;
        }
    }

    public class Hero
    {
        public object heroData = null;
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

    public List<Hero> heroes = new List<Hero>();
    public QuestLog log = new QuestLog();
    public EventManagerStub eManager = new EventManagerStub();
    public QuestDataHolder qd = new QuestDataHolder();

    public int GetHeroCount()
    {
        int count = 0;
        foreach (Hero h in heroes) if (h.heroData != null) count++;
        return count;
    }
}

public static class MonsterDialogMoM
{
    public static void DrawMonster(Quest.Monster m, bool displayHealth = false) { }
}

public class Game
{
    public const string DIALOG = "dialog";
    public ContentData cd = new ContentData();
    public Quest CurrentQuest = new Quest();

    private static Game instance = new Game();
    public static Game Get() { return instance; }
    public static Game Fresh() { instance = new Game(); return instance; }
}
