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
            results.Add(r);
        }

        Console.WriteLine(results.ToJsonString());
    }

    static StringKey Key(JsonNode n)
    {
        if (n == null) return StringKey.NULL;
        // A quest ini's inline text is a literal; a {val:KEY} reference is not.
        string text = n.GetValue<string>();
        if (text.StartsWith("{") && text.EndsWith("}")) return new StringKey(text);
        return new StringKey(null, text, false);
    }

    static void Run(JsonNode c, JsonObject r)
    {
        Game game = Game.Fresh();
        bool mom = c["gameType"] == null || c["gameType"].GetValue<string>() == "MoM";
        game.gameType = mom ? (GameType)new MoMGameType() : new D2EGameType();

        if (c["vars"] != null)
            foreach (var kv in c["vars"].AsObject())
                game.CurrentQuest.vars.Values[kv.Key] = kv.Value.GetValue<float>();

        // A dictionary so {val:KEY} references resolve like the shipped app's.
        LocalizationRead.dicts.Clear();
        if (c["dictionary"] != null)
        {
            var lines = new List<string> { ".," + "English" };
            foreach (var kv in c["dictionary"].AsObject())
                lines.Add(kv.Key + "," + kv.Value.GetValue<string>());
            LocalizationRead.dicts["val"] = new DictionaryI18n(lines.ToArray(), "English");
        }

        game.CurrentQuest.RandomHero.heroData.name = Key(c["heroName"]);

        var ad = new ActivationData();
        ad.sectionName = c["section"] == null ? "MonsterActivationX" : c["section"].GetValue<string>();
        ad.ability = Key(c["ability"]);
        ad.minionActions = Key(c["minion"]);
        ad.masterActions = Key(c["master"]);
        ad.moveButton = Key(c["moveButton"]);
        ad.move = Key(c["move"]);

        var instance = new Quest.ActivationInstance(ad, c["monsterName"].GetValue<string>());

        r["effect"] = instance.effect;
        r["move"] = instance.move;
        r["minionActions"] = instance.minionActions;
        r["masterActions"] = instance.masterActions;
        r["section"] = instance.ad.sectionName;
    }
}
