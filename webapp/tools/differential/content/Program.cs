using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Assets.Scripts.Content;
using ValkyrieTools;

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
                r["ok"] = true;
                switch (c["kind"].GetValue<string>())
                {
                    case "section": Section(c, r); break;
                    case "pack": Pack(c, r); break;
                    case "loadIni": LoadIni(c, r); break;
                    default: throw new ArgumentException("unknown kind");
                }
            }
            catch (Exception ex)
            {
                r["ok"] = false;
                r["error"] = ex.GetType().Name;
                r.Remove("data");
            }
            results.Add(r);
        }

        Console.WriteLine(results.ToJsonString());
    }

    static Dictionary<string, string> Fields(JsonNode n)
    {
        var d = new Dictionary<string, string>();
        foreach (var kv in n.AsObject()) d[kv.Key] = kv.Value.GetValue<string>();
        return d;
    }

    static void ApplyContext(JsonNode c)
    {
        Game.StaticGameType.pps = c["pps"] != null ? c["pps"].GetValue<float>() : 105f;
        Game.StaticGameType.typeName = c["gameType"] != null ? c["gameType"].GetValue<string>() : "D2E";
        Game.AppDataPath = c["appData"] != null ? c["appData"].GetValue<string>() : "/appdata";
        UnityEngine.Application.platform = (c["android"] != null && c["android"].GetValue<bool>())
            ? UnityEngine.RuntimePlatform.Android
            : UnityEngine.RuntimePlatform.OSXPlayer;
        Game.SetInstance(new Game());
    }

    // Builds one content entry through the loader that claims the section, and
    // dumps every field the port models.
    static void Section(JsonNode c, JsonObject r)
    {
        ApplyContext(c);
        LocalizationRead.dicts.Clear();

        var cd = new ContentDataProbe();

        string name = c["section"].GetValue<string>();
        var fields = Fields(c["fields"]);
        string path = c["path"] != null ? c["path"].GetValue<string>() : "/pack";
        string packId = c["packId"] != null ? c["packId"].GetValue<string>() : "base";

        cd.LoadOne(name, fields, path, packId);
        r["data"] = cd.Dump();
    }

    static void Pack(JsonNode c, JsonObject r)
    {
        ApplyContext(c);
        var lines = c["ini"].AsArray().Select(x => x.GetValue<string>()).ToArray();

        // GetPackData re-reads content_pack.ini from disk, so the corpus lines
        // are written to a temp directory that stands in for the pack folder.
        string packDir = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(), "valkyrie-pack-probe");
        if (System.IO.Directory.Exists(packDir)) System.IO.Directory.Delete(packDir, true);
        System.IO.Directory.CreateDirectory(packDir);
        System.IO.File.WriteAllLines(
            System.IO.Path.Combine(packDir, "content_pack.ini"), lines);

        var pack = ContentDataProbe.ProbeGetPackData(
            packDir,
            c["requireGameType"] != null ? c["requireGameType"].GetValue<string>() : string.Empty,
            c["requireGameType"] != null);

        if (pack == null) { r["data"] = null; return; }

        var o = new JsonObject();
        o["name"] = pack.name;
        o["id"] = pack.id;
        o["type"] = pack.type;
        o["image"] = pack.image;
        o["icon"] = pack.icon;
        o["description"] = pack.description;
        o["clone"] = new JsonArray(pack.clone.Select(x => (JsonNode)x).ToArray());
        o["iniFiles"] = new JsonArray(pack.iniFiles.Select(x => (JsonNode)x).ToArray());
        var loc = new JsonArray();
        foreach (var kv in pack.localizationFiles)
            loc.Add(new JsonArray(kv.Key, new JsonArray(kv.Value.Select(x => (JsonNode)x).ToArray())));
        o["localizationFiles"] = loc;
        r["data"] = o;
    }

    // Loads a whole ini (many sections) and dumps the resulting registry, which
    // also exercises priority resolution and set merging.
    static void LoadIni(JsonNode c, JsonObject r)
    {
        ApplyContext(c);
        LocalizationRead.dicts.Clear();

        var cd = new ContentDataProbe();
        foreach (JsonNode file in c["files"].AsArray())
        {
            var lines = file["lines"].AsArray().Select(x => x.GetValue<string>()).ToArray();
            IniData d = IniRead.ReadFromStringArray(lines, "x.ini");
            string path = file["path"].GetValue<string>();
            string packId = file["packId"].GetValue<string>();
            foreach (var section in d.data) cd.LoadOne(section.Key, section.Value, path, packId);
        }
        r["data"] = cd.Dump();
    }
}
