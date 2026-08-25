// Stand-ins for everything RoundController.cs and RoundControllerMoM.cs reach
// for through Game.Get(). No ported logic lives here: these types exist only so
// the two real sources compile and so every call they make is recorded.
//
// The event engine is a scripted stub rather than the real EventManager. The
// contract under test is what the round controller *decides* — which monster
// acts, which triggers fire, when the round turns over — given identical
// answers from the engine, so the engine's own behaviour is held fixed on both
// sides.

using System;
using System.Collections.Generic;
using System.Linq;

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

    public static class Mathf
    {
        public static int RoundToInt(float f) { return (int)System.Math.Round((double)f); }
    }

    public static class Application
    {
        public static void Quit() { throw new HarnessQuitException(); }
    }

    public class HarnessQuitException : Exception { }

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
        public static void Log(string message) { Trace.Add("debug:" + message); }
    }
}

namespace Assets.Scripts.Content
{
    public class StringKey
    {
        public string key;
        public string fullKey;
        string[] parameters;

        public static StringKey NULL = new StringKey(null, "", false);

        public StringKey(string dict, string k, params string[] p)
        {
            key = k;
            parameters = p;
            fullKey = k == null ? "" : k;
        }

        public StringKey(string dict, string k, bool translate)
        {
            key = k;
            parameters = new string[0];
            fullKey = translate ? k : (k == null ? "" : k);
        }

        public StringKey(string dict, string k, int p)
        {
            key = k;
            parameters = new string[] { p.ToString() };
            fullKey = k;
        }

        public string Translate(bool quoted = false)
        {
            if (parameters == null || parameters.Length == 0) return key;
            return key + " " + string.Join(" ", parameters);
        }
    }
}

public class GenericData
{
    public string sectionName = "";
    public string name = "";
}

public class MonsterData : GenericData
{
    public string[] activations = new string[0];
    public float healthBase = 0;
    public float healthPerHero = 0;
}

public class QuestMonster : MonsterData
{
    public string derivedType = "";
    public bool useMonsterTypeActivations = true;
}

public class ActivationData : GenericData
{
    public Assets.Scripts.Content.StringKey minionActions = Assets.Scripts.Content.StringKey.NULL;
    public Assets.Scripts.Content.StringKey masterActions = Assets.Scripts.Content.StringKey.NULL;
    public bool masterFirst = false;
    public bool minionFirst = false;
}

public class QuestActivation : ActivationData
{
    public QuestActivation(QuestData.Activation a)
    {
        sectionName = a.sectionName;
        name = a.sectionName;
        minionActions = a.minionActions;
        masterActions = a.masterActions;
        masterFirst = a.masterFirst;
        minionFirst = a.minionFirst;
    }
}

public static class QuestData
{
    public class QuestComponent
    {
        public string sectionName = "";
    }

    public class Activation : QuestComponent
    {
        public VarTests tests = null;
        public Assets.Scripts.Content.StringKey minionActions = Assets.Scripts.Content.StringKey.NULL;
        public Assets.Scripts.Content.StringKey masterActions = Assets.Scripts.Content.StringKey.NULL;
        public bool masterFirst = false;
        public bool minionFirst = false;
    }
}

public class QuestDataHolder
{
    public Dictionary<string, QuestData.QuestComponent> components =
        new Dictionary<string, QuestData.QuestComponent>();
}

public class EventStub
{
    public string name;
    public bool disabled;
    public bool Disabled() { return disabled; }
}

public class EventManagerStub
{
    public object currentEvent = null;
    public Stack<string> eventStack = new Stack<string>();
    public Dictionary<string, EventStub> events = new Dictionary<string, EventStub>();
    public Quest.Monster monsterImage = null;

    /// Trigger types the harness declares as having at least one live event.
    public HashSet<string> liveTriggers = new HashSet<string>();
    /// Trigger types that leave an event open once triggered.
    public HashSet<string> blockingTriggers = new HashSet<string>();

    public bool EventTriggerType(string type, bool trigger = true)
    {
        bool any = liveTriggers.Contains(type);
        Trace.Add("trigger:" + type + ":" + (trigger ? "1" : "0") + "=" + (any ? "1" : "0"));
        if (any)
        {
            eventStack.Push(type);
            if (trigger) TriggerEvent();
        }
        return any;
    }

    public void QueueEvent(string name, bool trigger = true)
    {
        Trace.Add("queue:" + name);
        eventStack.Push(name);
        if (trigger) TriggerEvent();
    }

    public void TriggerEvent()
    {
        Trace.Add("triggerEvent");
        if (currentEvent != null) return;
        while (eventStack.Count > 0)
        {
            string name = eventStack.Pop();
            if (blockingTriggers.Contains(name))
            {
                currentEvent = name;
                Trace.Add("open:" + name);
                return;
            }
            Trace.Add("ran:" + name);
        }
    }
}

public class Quest
{
    public enum MoMPhase { investigator, mythos, monsters, horror }

    public class Hero
    {
        public bool activated = false;
        public object heroData = null;
        public string id = "";
    }

    public class Monster
    {
        public bool activated = false;
        public bool minionStarted = false;
        public bool masterStarted = false;
        public MonsterActivation currentActivation = null;
        public MonsterData monsterData = null;
        public string id = "";
        public string spawnEventName = "";
        public int damage = 0;
        public int healthMod = 0;

        public void NewActivation(ActivationData ad)
        {
            currentActivation = new MonsterActivation(ad);
        }

        public string GetIdentifier() { return id; }

        public int GetHealth()
        {
            return UnityEngine.Mathf.RoundToInt(monsterData.healthBase +
                (Game.Get().CurrentQuest.GetHeroCount() * monsterData.healthPerHero)) + healthMod;
        }
    }

    public class MonsterActivation
    {
        public ActivationData ad;
        public MonsterActivation(ActivationData a) { ad = a; }
    }

    public class LogEntry
    {
        public string entry;
        public bool editor;
        public LogEntry(string e, bool ed = false) { entry = e; editor = ed; }
    }

    public class QuestLog
    {
        public List<LogEntry> entries = new List<LogEntry>();
        public void Add(LogEntry e) { entries.Add(e); }
    }

    public List<Hero> heroes = new List<Hero>();
    public List<Monster> monsters = new List<Monster>();
    public VarManager vars = new VarManager();
    public QuestLog log = new QuestLog();
    public EventManagerStub eManager = new EventManagerStub();
    public QuestDataHolder qd = new QuestDataHolder();
    public MoMPhase phase = MoMPhase.investigator;

    public int GetHeroCount()
    {
        int count = 0;
        foreach (Hero h in heroes) if (h.heroData != null) count++;
        return count;
    }

    public void AdjustMorale(int m, bool delay = false)
    {
        float morale = vars.GetValue("$%morale") + m;
        vars.SetValue("$%morale", morale);
        if (morale < 0)
        {
            morale = 0;
            if (delay) { morale = -1; return; }
            eManager.EventTriggerType("NoMorale");
        }
    }
}

public class ContentData
{
    public Dictionary<string, MonsterData> monsters = new Dictionary<string, MonsterData>();
    public Dictionary<string, ActivationData> activations = new Dictionary<string, ActivationData>();

    public bool ContainsKey<T>(string name)
    {
        if (typeof(T) == typeof(MonsterData)) return monsters.ContainsKey(name);
        return activations.ContainsKey(name);
    }

    public T Get<T>(string name) where T : class
    {
        if (typeof(T) == typeof(MonsterData)) return monsters[name] as T;
        return activations[name] as T;
    }

    public Dictionary<string, T> GetAll<T>() where T : class
    {
        var result = new Dictionary<string, T>();
        foreach (var kv in activations) result[kv.Key] = kv.Value as T;
        return result;
    }

    public bool TryGet(string name, out ActivationData data)
    {
        return activations.TryGetValue(name, out data);
    }
}

public class GameType { }
public class MoMGameType : GameType { }
public class D2EGameType : GameType { }

// The extracted Defeated calls this; the port has no canvas to tear down.
public static class Destroyer
{
    public static void Dialog() { }
}

public class MonsterCanvas
{
    public void UpdateStatus() { }
    public void UpdateList() { }
}

public class HeroCanvas
{
    public void UpdateStatus() { }
}

public class StageUI
{
    public void Update() { }
}

public class AudioControl
{
    public void PlayTrait(string trait) { Trace.Add("audio:" + trait); }
}

public class ActivateDialog
{
    public ActivateDialog(Quest.Monster m, bool master, bool single = false)
    {
        Trace.Add("dialog:" + m.id + ":master=" + (master ? "1" : "0") + ":single=" + (single ? "1" : "0"));
    }
}

public class ActivateDialogMoM
{
    public ActivateDialogMoM(Quest.Monster m) { Trace.Add("dialogMoM:" + m.id); }
}

public static class ChangePhaseWindow
{
    public static void DisplayTransitionWindow(Quest.MoMPhase phase)
    {
        Trace.Add("phaseWindow:" + phase);
    }
}

public static class SaveManager
{
    public static void Save(int slot) { Trace.Add("save:" + slot); }
}

public class Game
{
    static Game instance;
    public Quest CurrentQuest = new Quest();
    public ContentData cd = new ContentData();
    public GameType gameType = new D2EGameType();
    public MonsterCanvas monsterCanvas = new MonsterCanvas();
    public HeroCanvas heroCanvas = new HeroCanvas();
    public StageUI stageUI = new StageUI();
    public AudioControl audioControl = new AudioControl();
    public RoundController roundControl;

    public static Game Get() { return instance; }
    public static Game Fresh() { instance = new Game(); return instance; }
}
