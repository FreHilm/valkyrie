using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Assets.Scripts.Content;

class Program
{
    static void Main(string[] args)
    {
        JsonNode corpus = JsonNode.Parse(System.IO.File.ReadAllText(args[0]));
        var results = new JsonArray();

        foreach (JsonNode c in corpus.AsArray())
        {
            var r = new JsonObject();
            r["name"] = c["name"].GetValue<string>();
            Trace.Reset();
            try
            {
                Run(c);
                r["ok"] = true;
            }
            catch (Exception ex)
            {
                r["ok"] = false;
                r["error"] = ex.GetType().Name;
            }
            r["trace"] = new JsonArray(Trace.Lines.Select(l => (JsonNode)JsonValue.Create(l)).ToArray());
            if (r["ok"] != null && r["ok"].GetValue<bool>()) r["state"] = State();
            results.Add(r);
        }

        Console.WriteLine(results.ToJsonString());
    }

    static string[] Strings(JsonNode n)
    {
        if (n == null) return new string[0];
        return n.AsArray().Select(x => x.GetValue<string>()).ToArray();
    }

    static void Run(JsonNode c)
    {
        Game game = Game.Fresh();
        Quest quest = game.CurrentQuest;

        bool mom = c["kind"].GetValue<string>() == "mom";
        if (mom) game.gameType = new MoMGameType();

        UnityEngine.Random.Script = c["random"] == null
            ? new List<int>()
            : c["random"].AsArray().Select(x => x.GetValue<int>()).ToList();
        UnityEngine.Random.Cursor = 0;

        if (c["vars"] != null)
            foreach (var kv in c["vars"].AsObject())
                quest.vars.vars[kv.Key] = kv.Value.GetValue<float>();

        foreach (string t in Strings(c["liveTriggers"])) quest.eManager.liveTriggers.Add(t);
        foreach (string t in Strings(c["blockingTriggers"])) quest.eManager.blockingTriggers.Add(t);

        if (mom && c["phase"] != null)
            quest.phase = (Quest.MoMPhase)Enum.Parse(typeof(Quest.MoMPhase), c["phase"].GetValue<string>());

        if (c["events"] != null)
            foreach (var kv in c["events"].AsObject())
                quest.eManager.events[kv.Key] = new EventStub
                {
                    name = kv.Key,
                    disabled = kv.Value["disabled"].GetValue<bool>(),
                };

        // Content activations
        if (c["contentActivations"] != null)
            foreach (var kv in c["contentActivations"].AsObject())
                game.cd.activations[kv.Key] = Activation(kv.Key, kv.Value);

        // Quest Activation components
        if (c["questActivations"] != null)
            foreach (var kv in c["questActivations"].AsObject())
            {
                var a = new QuestData.Activation();
                a.sectionName = kv.Key;
                a.minionActions = new StringKey(null, kv.Value["minion"].GetValue<string>());
                a.masterActions = new StringKey(null, kv.Value["master"].GetValue<string>());
                a.masterFirst = kv.Value["masterFirst"] != null && kv.Value["masterFirst"].GetValue<bool>();
                a.minionFirst = kv.Value["minionFirst"] != null && kv.Value["minionFirst"].GetValue<bool>();
                if (kv.Value["tests"] != null)
                {
                    a.tests = new VarTests();
                    foreach (string part in Strings(kv.Value["tests"])) a.tests.Add(part);
                }
                quest.qd.components[kv.Key] = a;
            }

        // Monster types
        var types = new Dictionary<string, MonsterData>();
        if (c["monsterTypes"] != null)
            foreach (var kv in c["monsterTypes"].AsObject())
            {
                MonsterData md;
                bool isQuest = kv.Value["quest"] != null && kv.Value["quest"].GetValue<bool>();
                if (isQuest)
                {
                    var qm = new QuestMonster();
                    qm.derivedType = kv.Value["derivedType"] == null ? "" : kv.Value["derivedType"].GetValue<string>();
                    qm.useMonsterTypeActivations = kv.Value["useMonsterTypeActivations"] == null
                        || kv.Value["useMonsterTypeActivations"].GetValue<bool>();
                    md = qm;
                }
                else
                {
                    md = new MonsterData();
                    game.cd.monsters[kv.Key] = md;
                }
                md.sectionName = kv.Key;
                md.name = kv.Key;
                md.activations = Strings(kv.Value["activations"]);
                md.healthBase = kv.Value["healthBase"] == null ? 0 : kv.Value["healthBase"].GetValue<float>();
                md.healthPerHero = kv.Value["healthPerHero"] == null ? 0 : kv.Value["healthPerHero"].GetValue<float>();
                types[kv.Key] = md;
            }

        foreach (JsonNode h in (c["heroes"] ?? new JsonArray()).AsArray())
        {
            var hero = new Quest.Hero();
            hero.id = h["id"].GetValue<string>();
            hero.activated = h["activated"] != null && h["activated"].GetValue<bool>();
            if (h["present"] == null || h["present"].GetValue<bool>()) hero.heroData = new object();
            quest.heroes.Add(hero);
        }

        foreach (JsonNode m in (c["monsters"] ?? new JsonArray()).AsArray())
        {
            var monster = new Quest.Monster();
            monster.id = m["id"].GetValue<string>();
            monster.monsterData = types[m["type"].GetValue<string>()];
            monster.activated = m["activated"] != null && m["activated"].GetValue<bool>();
            monster.minionStarted = m["minionStarted"] != null && m["minionStarted"].GetValue<bool>();
            monster.masterStarted = m["masterStarted"] != null && m["masterStarted"].GetValue<bool>();
            monster.spawnEventName = m["spawnedBy"] == null ? "" : m["spawnedBy"].GetValue<string>();
            monster.healthMod = m["healthMod"] == null ? 0 : m["healthMod"].GetValue<int>();
            quest.monsters.Add(monster);
        }

        game.roundControl = mom ? new RoundControllerMoM() : new RoundController();

        foreach (string command in Strings(c["commands"]))
        {
            Trace.Add("> " + command);
            switch (command)
            {
                case "heroActivated": game.roundControl.HeroActivated(); break;
                case "monsterActivated": game.roundControl.MonsterActivated(); break;
                case "checkNewRound": Trace.Add("= " + (game.roundControl.CheckNewRound() ? "true" : "false")); break;
                case "endRound": game.roundControl.EndRound(); break;
                case "activateMonster": Trace.Add("= " + (game.roundControl.ActivateMonster() ? "true" : "false")); break;
                case "reset": game.roundControl.Reset(); break;
                case "closeEvent": quest.eManager.currentEvent = null; break;
                case "defeatFirst":
                    if (quest.monsters.Count > 0) MonsterDialogMoM.Defeated(quest.monsters[0]);
                    break;
                case "health":
                    foreach (Quest.Monster m in quest.monsters)
                        Trace.Add("health:" + m.id + "=" + m.GetHealth());
                    break;
                default: throw new ArgumentException("unknown command");
            }
        }
    }

    static ActivationData Activation(string name, JsonNode n)
    {
        var a = new ActivationData();
        a.sectionName = name;
        a.name = name;
        a.minionActions = new StringKey(null, n["minion"].GetValue<string>());
        a.masterActions = new StringKey(null, n["master"].GetValue<string>());
        a.masterFirst = n["masterFirst"] != null && n["masterFirst"].GetValue<bool>();
        a.minionFirst = n["minionFirst"] != null && n["minionFirst"].GetValue<bool>();
        return a;
    }

    static JsonObject State()
    {
        Game game = Game.Get();
        Quest quest = game.CurrentQuest;
        var s = new JsonObject();
        s["phase"] = quest.phase.ToString();

        var monsters = new JsonArray();
        foreach (Quest.Monster m in quest.monsters)
        {
            var o = new JsonObject();
            o["id"] = m.id;
            o["activated"] = m.activated;
            o["minionStarted"] = m.minionStarted;
            o["masterStarted"] = m.masterStarted;
            o["activation"] = m.currentActivation == null ? null : m.currentActivation.ad.sectionName;
            monsters.Add(o);
        }
        s["monsters"] = monsters;

        var heroes = new JsonArray();
        foreach (Quest.Hero h in quest.heroes)
        {
            var o = new JsonObject();
            o["id"] = h.id;
            o["activated"] = h.activated;
            heroes.Add(o);
        }
        s["heroes"] = heroes;

        var vars = new JsonObject();
        foreach (var kv in quest.vars.vars.OrderBy(x => x.Key, StringComparer.Ordinal))
            vars[kv.Key] = kv.Value;
        s["vars"] = vars;

        var logs = new JsonArray();
        foreach (Quest.LogEntry e in quest.log.entries)
            logs.Add((JsonNode)JsonValue.Create((e.editor ? "E:" : "") + e.entry));
        s["log"] = logs;

        s["currentEvent"] = quest.eManager.currentEvent == null ? null : (string)quest.eManager.currentEvent;
        s["stack"] = new JsonArray(quest.eManager.eventStack.Select(x => (JsonNode)JsonValue.Create(x)).ToArray());
        s["monsterImage"] = quest.eManager.monsterImage == null ? null : quest.eManager.monsterImage.id;
        return s;
    }
}
