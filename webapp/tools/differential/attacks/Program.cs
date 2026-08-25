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

        UnityEngine.Random.Script = c["random"] == null
            ? new List<int>()
            : c["random"].AsArray().Select(x => x.GetValue<int>()).ToList();
        UnityEngine.Random.Cursor = 0;

        foreach (JsonNode a in (c["attacks"] ?? new JsonArray()).AsArray())
            game.cd.attacks.Add(new AttackData
            {
                sectionName = a["section"].GetValue<string>(),
                target = a["target"].GetValue<string>(),
                attackType = a["attackType"].GetValue<string>(),
                text = new StringKey(null, a["text"].GetValue<string>(), false),
            });

        MonsterData md;
        bool isQuest = c["quest"] != null && c["quest"].GetValue<bool>();
        if (isQuest)
        {
            var qm = new QuestMonster();
            foreach (var kv in (c["investigatorAttacks"] ?? new JsonObject()).AsObject())
                qm.cMonster.investigatorAttacks[kv.Key] = Strings(kv.Value)
                    .Select(t => new StringKey(null, t, false))
                    .ToList();
            md = qm;
        }
        else
        {
            md = new MonsterData();
        }
        md.sectionName = c["type"].GetValue<string>();
        md.traits = Strings(c["traits"]);

        r["types"] = new JsonArray(md.GetAttackTypes().Select(t => (JsonNode)JsonValue.Create(t)).ToArray());

        if (c["attackType"] != null)
        {
            StringKey text = md.GetRandomAttack(c["attackType"].GetValue<string>());
            r["attack"] = text == null ? null : text.key;
        }
    }
}
