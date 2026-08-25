using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
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
                    case "quest": QuestMeta(c, r); break;
                    case "loadIni": LoadIni(c, r); break;
                    case "varTests": VarTestsCase(c, r); break;
                    case "button": ButtonCase(c, r); break;
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
        Game.StaticGameType.typeName = c["gameType"] != null ? c["gameType"].GetValue<string>() : "D2E";
        Game.StaticGameType.maxHeroes = c["maxHeroes"] != null ? c["maxHeroes"].GetValue<int>() : 4;
        Game.StaticGameType.defaultHeroes = c["defaultHeroes"] != null ? c["defaultHeroes"].GetValue<int>() : 4;
        var g = new Game();
        Game.SetInstance(g);
        Game.game = g;
        LocalizationRead.dicts.Clear();
    }

    static QuestData NewQuestData()
    {
        // The QuestData constructor reads files; the harness only needs the
        // instance so it can drive the private AddData dispatch.
        return (QuestData)System.Runtime.Serialization.FormatterServices
            .GetUninitializedObject(typeof(QuestData));
    }

    static void InitQuestData(QuestData qd, int format)
    {
        typeof(QuestData).GetField("components").SetValue(qd, new Dictionary<string, QuestData.QuestComponent>());
        typeof(QuestData).GetField("game", BindingFlags.Instance | BindingFlags.NonPublic)
            .SetValue(qd, Game.Get());

        var quest = (QuestData.Quest)System.Runtime.Serialization.FormatterServices
            .GetUninitializedObject(typeof(QuestData.Quest));
        typeof(QuestData.Quest).GetField("format").SetValue(quest, format);
        typeof(QuestData).GetField("quest").SetValue(qd, quest);
    }

    static void AddSection(QuestData qd, string name, Dictionary<string, string> content, string source)
    {
        var m = typeof(QuestData).GetMethod("AddData", BindingFlags.Instance | BindingFlags.NonPublic);
        try { m.Invoke(qd, new object[] { name, content, source }); }
        catch (TargetInvocationException e) { throw e.InnerException ?? e; }
    }

    static void Section(JsonNode c, JsonObject r)
    {
        ApplyContext(c);
        var qd = NewQuestData();
        int format = c["format"] != null ? c["format"].GetValue<int>() : 21;
        InitQuestData(qd, format);

        AddSection(qd, c["section"].GetValue<string>(), Fields(c["fields"]),
                   c["source"] != null ? c["source"].GetValue<string>() : "quest.ini");

        r["data"] = DumpComponents(qd);
    }

    static void LoadIni(JsonNode c, JsonObject r)
    {
        ApplyContext(c);
        var qd = NewQuestData();
        int format = c["format"] != null ? c["format"].GetValue<int>() : 21;
        InitQuestData(qd, format);

        var lines = c["lines"].AsArray().Select(x => x.GetValue<string>()).ToArray();
        IniData d = IniRead.ReadFromStringArray(lines, "quest.ini");
        string source = c["source"] != null ? c["source"].GetValue<string>() : "quest.ini";
        foreach (var section in d.data) AddSection(qd, section.Key, section.Value, source);

        r["data"] = DumpComponents(qd);
    }

    static void QuestMeta(JsonNode c, JsonObject r)
    {
        ApplyContext(c);

        var ctx = new QuestData.QuestLoaderContext();
        ctx.gameType = Game.StaticGameType.typeName;
        ctx.maxHeroes = Game.StaticGameType.maxHeroes;
        ctx.defaultHeroes = Game.StaticGameType.defaultHeroes;
        ctx.currentLang = "English";
        ctx.isMoM = c["isMoM"] != null && c["isMoM"].GetValue<bool>();

        // GetUninitializedObject skips the static constructor too, which would
        // leave currentFormat at 0 and fail every format check.
        System.Runtime.CompilerServices.RuntimeHelpers.RunClassConstructor(
            typeof(QuestData.Quest).TypeHandle);

        var quest = (QuestData.Quest)System.Runtime.Serialization.FormatterServices
            .GetUninitializedObject(typeof(QuestData.Quest));
        // Instance field initializers are skipped as well, so the declared
        // defaults are restored by hand.
        typeof(QuestData.Quest).GetField("format").SetValue(quest, 0);
        typeof(QuestData.Quest).GetField("hidden").SetValue(quest, false);
        typeof(QuestData.Quest).GetField("valid").SetValue(quest, false);
        typeof(QuestData.Quest).GetField("path").SetValue(quest, "");
        typeof(QuestData.Quest).GetField("defaultLanguage").SetValue(quest, "English");
        typeof(QuestData.Quest).GetField("defaultMusicOn").SetValue(quest, false);
        typeof(QuestData.Quest).GetField("image").SetValue(quest, "");
        typeof(QuestData.Quest).GetField("minHero").SetValue(quest, 2);
        typeof(QuestData.Quest).GetField("maxHero").SetValue(quest, 5);
        typeof(QuestData.Quest).GetField("difficulty").SetValue(quest, 0f);
        typeof(QuestData.Quest).GetField("lengthMin").SetValue(quest, 0);
        typeof(QuestData.Quest).GetField("lengthMax").SetValue(quest, 0);
        typeof(QuestData.Quest).GetField("version").SetValue(quest, "");
        typeof(QuestData.Quest).GetField("identifier")
            .SetValue(quest, c["identifier"].GetValue<string>().ToLower());
        typeof(QuestData.Quest).GetField("context", BindingFlags.Instance | BindingFlags.NonPublic)
            .SetValue(quest, ctx);
        typeof(QuestData.Quest).GetField("localizationDict")
            .SetValue(quest, new DictionaryI18n(new string[] { ".,English" }));

        bool valid = quest.Populate(Fields(c["fields"]));
        if (Environment.GetEnvironmentVariable("QUEST_DEBUG") != null)
        {
            Console.Error.WriteLine($"currentFormat={QuestData.Quest.currentFormat} min={QuestData.Quest.minumumFormat} format={quest.format} valid={valid}");
        }

        // The constructor is what assigns the field; Populate only returns.
        typeof(QuestData.Quest).GetField("valid").SetValue(quest, valid);

        var o = new JsonObject();
        o["valid"] = valid;
        foreach (var f in typeof(QuestData.Quest)
                     .GetFields(BindingFlags.Instance | BindingFlags.Public)
                     .OrderBy(f => f.Name, StringComparer.Ordinal))
        {
            // Download-manager state, not quest data — ported with T-013.
            if (f.Name == "localizationDict" || f.Name == "latest_update"
                || f.Name == "downloaded" || f.Name == "update_available"
                || f.Name == "package_url") continue;
            // An invalid quest returns before these are assigned, so their
            // values are whatever the field initializer left. Not comparable.
            if (!valid && f.Name != "format" && f.Name != "identifier") continue;
            o[f.Name] = Render(f.GetValue(quest));
        }
        r["data"] = o;
    }

    static void VarTestsCase(JsonNode c, JsonObject r)
    {
        var tests = new VarTests();
        foreach (JsonNode part in c["parts"].AsArray()) tests.Add(part.GetValue<string>());

        var o = new JsonObject();
        o["toString"] = tests.ToString();
        o["count"] = tests.VarTestsComponents.Count;
        var items = new JsonArray();
        foreach (var v in tests.VarTestsComponents)
        {
            items.Add(new JsonArray(v.GetClassVarTestsComponentType(), v.ToString()));
        }
        o["items"] = items;

        if (c["remove"] != null) { tests.Remove(c["remove"].GetValue<int>()); o["afterRemove"] = Dump(tests); }
        if (c["findClosing"] != null) o["findClosing"] = tests.FindClosingParenthesis(c["findClosing"].GetValue<int>());
        if (c["findOpening"] != null) o["findOpening"] = tests.FindOpeningParenthesis(c["findOpening"].GetValue<int>());
        if (c["nextPos"] != null)
            o["nextPos"] = tests.FindNextValidPosition(c["nextPos"].GetValue<int>(), c["up"].GetValue<bool>());
        if (c["move"] != null)
        {
            tests.moveComponent(c["move"].GetValue<int>(), c["up"].GetValue<bool>());
            o["afterMove"] = Dump(tests);
        }
        r["data"] = o;
    }

    static JsonArray Dump(VarTests tests)
    {
        var items = new JsonArray();
        foreach (var v in tests.VarTestsComponents)
            items.Add(new JsonArray(v.GetClassVarTestsComponentType(), v.ToString()));
        return items;
    }

    static void ButtonCase(JsonNode c, JsonObject r)
    {
        ApplyContext(c);
        var button = QuestButtonDataSerializer.FromData(
            Fields(c["fields"]), c["position"].GetValue<int>(), c["section"].GetValue<string>());

        var o = new JsonObject();
        o["label"] = button.Label.fullKey;
        o["eventNames"] = new JsonArray(button.EventNames.Select(x => (JsonNode)x).ToArray());
        o["color"] = button.Color;
        o["hasCondition"] = button.HasCondition;
        o["conditionFailedAction"] = button.ConditionFailedAction.ToString();
        o["condition"] = button.Condition.ToString();
        o["toString"] = button.ToString().Replace(Environment.NewLine, "\n");
        r["data"] = o;
    }

    static JsonArray DumpComponents(QuestData qd)
    {
        var components = (Dictionary<string, QuestData.QuestComponent>)
            typeof(QuestData).GetField("components").GetValue(qd);

        var outer = new JsonArray();
        foreach (var kv in components.OrderBy(kv => kv.Key, StringComparer.Ordinal))
        {
            outer.Add(new JsonArray(kv.Key, DumpObject(kv.Value)));
        }
        return outer;
    }

    static readonly HashSet<string> Skipped = new HashSet<string>
    {
        "type", "image", "gameObject",
    };

    // Emitted in name order so the raw JSON comparison is not order-sensitive.
    static JsonObject DumpObject(object o)
    {
        var collected = new SortedDictionary<string, JsonNode>(StringComparer.Ordinal);
        var t = o.GetType();

        foreach (var f in t.GetFields(BindingFlags.Instance | BindingFlags.Public))
        {
            if (Skipped.Contains(f.Name)) continue;
            collected[f.Name] = Render(f.GetValue(o));
        }
        foreach (var p in t.GetProperties(BindingFlags.Instance | BindingFlags.Public))
        {
            if (Skipped.Contains(p.Name) || p.GetIndexParameters().Length > 0) continue;
            collected[p.Name] = Render(p.GetValue(o));
        }

        var result = new JsonObject();
        foreach (var kv in collected) result[kv.Key] = kv.Value;
        return result;
    }

    // NaN and the infinities are not valid JSON numbers.
    static JsonNode RenderFloat(float f)
    {
        if (float.IsNaN(f)) return "NaN";
        if (float.IsInfinity(f)) return f > 0 ? "Infinity" : "-Infinity";
        return (double)f;
    }

    static JsonNode Render(object v)
    {
        if (v == null) return null;
        if (v is StringKey sk) return sk.fullKey;
        if (v is string s) return s;
        if (v is bool b) return b;
        if (v is int i) return i;
        if (v is float f) return RenderFloat(f);
        if (v is UnityEngine.Vector2 vec) return new JsonArray(RenderFloat(vec.x), RenderFloat(vec.y));
        if (v is VarTests vt) return vt.ToString();
        if (v is System.DateTime dt) return dt.ToString("o");
        if (v is QuestButtonData qb)
        {
            var o = new JsonObject();
            o["label"] = qb.Label.fullKey;
            o["eventNames"] = new JsonArray(qb.EventNames.Select(x => (JsonNode)x).ToArray());
            o["color"] = qb.Color;
            o["condition"] = qb.Condition.ToString();
            o["action"] = qb.ConditionFailedAction.ToString();
            return o;
        }
        if (v is VarTestsComponent tc) return tc.GetClassVarTestsComponentType() + ":" + tc.ToString();
        if (v is IDictionary dict)
        {
            var arr = new JsonArray();
            foreach (DictionaryEntry e in dict) arr.Add(new JsonArray(Render(e.Key), Render(e.Value)));
            return arr;
        }
        if (v is IEnumerable e2)
        {
            var arr = new JsonArray();
            foreach (var item in e2) arr.Add(Render(item));
            return arr;
        }
        if (v is Enum) return v.ToString();
        return v.ToString();
    }
}
