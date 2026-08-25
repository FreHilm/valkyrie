using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Assets.Scripts.Content;

// Exposes the protected members so the harness can exercise them directly.
class ProbeDict : DictionaryI18n
{
    public ProbeDict() : base() { }
    public ProbeDict(string[] data) : base(data) { }
    public string Probe_ParseEntry(string entry) { return ParseEntry(entry); }
}

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
                    case "parseEntry": ParseEntry(c, r); break;
                    case "addData": AddData(c, r); break;
                    case "getValue": GetValue(c, r); break;
                    case "getValueMany": GetValueMany(c, r); break;
                    case "stringKey": StringKeyCase(c, r); break;
                    case "dictLookup": DictLookup(c, r); break;
                    case "split3": Split3(c, r); break;
                    default: throw new ArgumentException("unknown kind");
                }
            }
            catch (Exception ex)
            {
                r["ok"] = false;
                r["error"] = ex.GetType().Name;
                r.Remove("value");
                r.Remove("data");
            }
            results.Add(r);
        }

        Console.WriteLine(results.ToJsonString());
    }

    static string[] Strings(JsonNode n)
    {
        var arr = n.AsArray();
        var result = new string[arr.Count];
        for (int i = 0; i < result.Length; i++) result[i] = arr[i].GetValue<string>();
        return result;
    }

    static void ParseEntry(JsonNode c, JsonObject r)
    {
        r["value"] = new ProbeDict().Probe_ParseEntry(c["entry"].GetValue<string>());
    }

    // Feeds raw lines in, then reads the raw lines back out unchanged.
    static void AddData(JsonNode c, JsonObject r)
    {
        var d = new ProbeDict();
        foreach (JsonNode block in c["blocks"].AsArray())
        {
            d.AddData(Strings(block));
        }
        r["data"] = DumpRaw(d.SerializeMultiple());
        r["languages"] = new JsonArray(d.GetLanguagesList().Select(x => (JsonNode)x).ToArray());
    }

    // Feeds raw lines in, edits nothing, but forces a rebuild via AddEntry so
    // SerializeMultiple regenerates rather than echoing the input.
    static void GetValue(JsonNode c, JsonObject r)
    {
        var d = new ProbeDict();
        foreach (JsonNode block in c["blocks"].AsArray())
        {
            d.AddData(Strings(block));
        }

        if (c["defaultLanguage"] != null) d.defaultLanguage = c["defaultLanguage"].GetValue<string>();
        if (c["fallbackLanguage"] != null) d.fallbackLanguage = c["fallbackLanguage"].GetValue<string>();
        if (c["currentLanguage"] != null) d.currentLanguage = c["currentLanguage"].GetValue<string>();

        if (c["group"] != null)
        {
            d.SetKeyToGroup(c["group"]["key"].GetValue<string>(), c["group"]["groupId"].GetValue<string>());
            d.SetGroupTranslationLanguage(c["group"]["groupId"].GetValue<string>(), c["group"]["language"].GetValue<string>());
        }

        r["value"] = d.GetValue(c["key"].GetValue<string>());
        r["exists"] = d.KeyExists(c["key"].GetValue<string>());

        if (c["extractAll"] != null)
        {
            var matches = d.ExtractAllMatches(c["key"].GetValue<string>());
            var arr = new JsonArray();
            foreach (var kv in matches)
            {
                arr.Add(new JsonArray(kv.Key, kv.Value));
            }
            r["extractAll"] = arr;
        }

        if (c["serialize"] != null)
        {
            d.AddEntry("__PROBE__", "x");
            r["data"] = DumpRaw(d.SerializeMultiple());
        }
    }

    // One dictionary, many keys — keeps the real-content corpus a sane size.
    static void GetValueMany(JsonNode c, JsonObject r)
    {
        var d = new ProbeDict();
        foreach (JsonNode block in c["blocks"].AsArray()) d.AddData(Strings(block));

        if (c["defaultLanguage"] != null) d.defaultLanguage = c["defaultLanguage"].GetValue<string>();
        if (c["fallbackLanguage"] != null) d.fallbackLanguage = c["fallbackLanguage"].GetValue<string>();
        if (c["currentLanguage"] != null) d.currentLanguage = c["currentLanguage"].GetValue<string>();

        var arr = new JsonArray();
        foreach (string key in Strings(c["keys"]))
        {
            arr.Add(new JsonArray(key, d.GetValue(key), d.KeyExists(key)));
        }
        r["data"] = arr;
    }

    static void StringKeyCase(JsonNode c, JsonObject r)
    {
        LocalizationRead.dicts.Clear();
        if (c["dicts"] != null)
        {
            foreach (string name in Strings(c["dicts"]))
            {
                LocalizationRead.AddDictionary(name, new ProbeDict(new string[] { ".,English" }));
            }
        }

        StringKey sk = new StringKey(c["input"].GetValue<string>());
        r["dict"] = sk.dict;
        r["key"] = sk.key;
        r["fullKey"] = sk.fullKey;
        r["toString"] = sk.ToString();
        r["isKey"] = sk.isKey();
        r["regex"] = LocalizationRead.LookupRegexKey();
    }

    static void DictLookup(JsonNode c, JsonObject r)
    {
        LocalizationRead.dicts.Clear();
        foreach (JsonNode entry in c["dicts"].AsArray())
        {
            var d = new ProbeDict();
            foreach (JsonNode block in entry["blocks"].AsArray()) d.AddData(Strings(block));
            LocalizationRead.AddDictionary(entry["name"].GetValue<string>(), d);
        }

        StringKey sk = c["raw"] != null
            ? new StringKey(c["raw"].GetValue<string>())
            : new StringKey(c["dict"].GetValue<string>(), c["key"].GetValue<string>());

        r["value"] = sk.Translate();
        r["exists"] = sk.KeyExists();
        r["emptyIfNotFound"] = sk.Translate(true);
    }

    static void Split3(JsonNode c, JsonObject r)
    {
        string[] parts = c["input"].GetValue<string>()
            .Split(":".ToCharArray(), 3, StringSplitOptions.RemoveEmptyEntries);
        r["data"] = new JsonArray(parts.Select(x => (JsonNode)x).ToArray());
    }

    static JsonArray DumpRaw(Dictionary<string, List<string>> raw)
    {
        var outer = new JsonArray();
        foreach (var kv in raw)
        {
            outer.Add(new JsonArray(kv.Key, new JsonArray(kv.Value.Select(x => (JsonNode)x).ToArray())));
        }
        return outer;
    }
}
