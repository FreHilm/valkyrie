using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

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
                Run(c, r);
                r["ok"] = true;
            }
            catch (Exception ex)
            {
                r["ok"] = false;
                r["error"] = ex.GetType().Name;
            }
            r["trace"] = new JsonArray(Trace.Lines.Select(l => (JsonNode)JsonValue.Create(l)).ToArray());
            results.Add(r);
        }

        Console.WriteLine(results.ToJsonString());
    }

    static string[] Strings(JsonNode n)
    {
        if (n == null) return new string[0];
        return n.AsArray().Select(x => x.GetValue<string>()).ToArray();
    }

    static void Run(JsonNode c, JsonObject r)
    {
        Game game = Game.Fresh();
        var quest = new Quest();
        quest.game = game;
        game.CurrentQuest = quest;
        game.gameType.Name = c["gameType"] == null ? "MoM" : c["gameType"].GetValue<string>();

        UnityEngine.Random.Script = c["random"] == null
            ? new List<int>()
            : c["random"].AsArray().Select(x => x.GetValue<int>()).ToList();
        UnityEngine.Random.Cursor = 0;

        foreach (var kv in (c["contentMonsters"] ?? new JsonObject()).AsObject())
            game.cd.monsters[kv.Key] = new MonsterData
            {
                sectionName = kv.Key,
                traits = Strings(kv.Value),
            };

        foreach (var kv in (c["questMonsters"] ?? new JsonObject()).AsObject())
            quest.qd.components[kv.Key] = new QuestData.CustomMonster
            {
                sectionName = kv.Key,
                traits = Strings(kv.Value["traits"]),
                baseMonster = kv.Value["base"] == null ? "" : kv.Value["base"].GetValue<string>(),
            };

        foreach (var kv in (c["spawns"] ?? new JsonObject()).AsObject())
            quest.qd.components[kv.Key] = new QuestData.Spawn
            {
                sectionName = kv.Key,
                mTypes = Strings(kv.Value["types"]),
                mTraitsRequired = Strings(kv.Value["required"]),
                mTraitsPool = Strings(kv.Value["pool"]),
            };

        foreach (var kv in (c["selected"] ?? new JsonObject()).AsObject())
            quest.monsterSelect[kv.Key] = kv.Value.GetValue<string>();

        foreach (string name in Strings(c["onBoard"]))
            quest.monsters.Add(new Quest.Monster { monsterData = new MonsterData { sectionName = name } });

        bool result;
        if (c["viaRuntime"] != null && c["viaRuntime"].GetValue<bool>())
        {
            result = quest.RuntimeMonsterSelection(c["spawn"].GetValue<string>());
        }
        else
        {
            var spawn = quest.qd.components[c["spawn"].GetValue<string>()] as QuestData.Spawn;
            bool force = c["force"] == null || c["force"].GetValue<bool>();
            result = quest.AttemptMonsterMatch(spawn, force);
        }

        r["result"] = result;
        var selected = new JsonObject();
        foreach (var kv in quest.monsterSelect.OrderBy(x => x.Key, StringComparer.Ordinal))
            selected[kv.Key] = kv.Value;
        r["selected"] = selected;
    }
}
