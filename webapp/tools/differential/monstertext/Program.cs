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
            r["monsterImage"] = Game.Get().CurrentQuest.eManager.monsterImage == null
                ? null
                : Game.Get().CurrentQuest.eManager.monsterImage.id;
            results.Add(r);
        }

        Console.WriteLine(results.ToJsonString());
    }

    static void Run(JsonNode c)
    {
        Game game = Game.Fresh();

        UnityEngine.Random.Script = c["random"] == null
            ? new List<int>()
            : c["random"].AsArray().Select(x => x.GetValue<int>()).ToList();
        UnityEngine.Random.Cursor = 0;

        for (int i = 0; i < (c["heroes"] == null ? 0 : c["heroes"].GetValue<int>()); i++)
            game.CurrentQuest.heroes.Add(new Quest.Hero { heroData = new object() });

        foreach (JsonNode e in (c["evades"] ?? new JsonArray()).AsArray())
            game.cd.evades.Add(new EvadeData
            {
                sectionName = e["section"].GetValue<string>(),
                monster = e["monster"].GetValue<string>(),
                text = new StringKey(null, e["text"].GetValue<string>(), false),
            });

        foreach (JsonNode h in (c["horrors"] ?? new JsonArray()).AsArray())
            game.cd.horrors.Add(new HorrorData
            {
                sectionName = h["section"].GetValue<string>(),
                monster = h["monster"].GetValue<string>(),
                text = new StringKey(null, h["text"].GetValue<string>(), false),
            });

        foreach (string component in (c["questComponents"] ?? new JsonArray()).AsArray()
                     .Select(x => x.GetValue<string>()))
            game.CurrentQuest.qd.components[component] = new object();

        MonsterData md;
        bool isQuest = c["quest"] != null && c["quest"].GetValue<bool>();
        if (isQuest)
        {
            var qm = new QuestMonster();
            qm.derivedType = c["derivedType"] == null ? "" : c["derivedType"].GetValue<string>();
            qm.cMonster.evadeEvent = c["evadeEvent"] == null ? "" : c["evadeEvent"].GetValue<string>();
            qm.cMonster.horrorEvent = c["horrorEvent"] == null ? "" : c["horrorEvent"].GetValue<string>();
            md = qm;
        }
        else
        {
            md = new MonsterData();
        }
        md.sectionName = c["type"].GetValue<string>();
        md.name = new StringKey(null, c["monsterName"].GetValue<string>(), false);
        md.healthBase = c["healthBase"] == null ? 0 : c["healthBase"].GetValue<float>();

        var monster = new Quest.Monster
        {
            id = "m1",
            monsterData = md,
            damage = c["damage"] == null ? 0 : c["damage"].GetValue<int>(),
        };

        if (c["kind"].GetValue<string>() == "evade") new InvestigatorEvade(monster);
        else new HorrorCheck(monster);
    }
}
