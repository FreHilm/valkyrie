using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using ValkyrieTools;

class Program
{
    static void Main(string[] args)
    {
        ValkyrieDebug.enabled = false;
        string json = System.IO.File.ReadAllText(args[0]);
        JsonNode corpus = JsonNode.Parse(json);
        var results = new JsonArray();

        foreach (JsonNode c in corpus.AsArray())
        {
            var r = new JsonObject();
            r["name"] = c["name"].GetValue<string>();
            string kind = c["kind"].GetValue<string>();
            try
            {
                if (kind == "readFromString")
                {
                    IniData d = IniRead.ReadFromString(c["input"].GetValue<string>());
                    r["ok"] = true;
                    r["data"] = Dump(d);
                    r["toString"] = d.ToString().Replace(Environment.NewLine, "\n");
                }
                else // readSection
                {
                    var linesNode = c["lines"].AsArray();
                    string[] lines = new string[linesNode.Count];
                    for (int i = 0; i < lines.Length; i++) lines[i] = linesNode[i].GetValue<string>();
                    Dictionary<string, string> s =
                        IniRead.ReadFromStringArray(lines, "test.ini", c["section"].GetValue<string>());
                    r["ok"] = true;
                    r["data"] = DumpSection(s);
                }
            }
            catch (Exception ex)
            {
                r["ok"] = false;
                r["error"] = ex.GetType().Name;
            }
            results.Add(r);
        }

        Console.WriteLine(results.ToJsonString(new JsonSerializerOptions { WriteIndented = false }));
    }

    // Ordered dump: [[section, [[k,v],...]], ...] so key order is compared too
    static JsonArray Dump(IniData d)
    {
        var outer = new JsonArray();
        foreach (var kv in d.data)
        {
            var pair = new JsonArray();
            pair.Add(kv.Key);
            pair.Add(DumpSection(kv.Value));
            outer.Add(pair);
        }
        return outer;
    }

    static JsonArray DumpSection(Dictionary<string, string> s)
    {
        var arr = new JsonArray();
        foreach (var kv in s)
        {
            var pair = new JsonArray();
            pair.Add(kv.Key);
            pair.Add(kv.Value);
            arr.Add(pair);
        }
        return arr;
    }
}
