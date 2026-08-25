using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

class Program
{
    static void Main(string[] args)
    {
        // The real VersionCodeGenerate writes diagnostics to Console, which
        // would corrupt the JSON on stdout. Capture them for the duration.
        var realOut = Console.Out;
        Console.SetOut(new System.IO.StringWriter());

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
                    case "vars": Vars(c, r); break;
                    case "test": Test(c, r); break;
                    case "code": Code(c, r); break;
                    case "image": Image(c, r); break;
                    case "slide": Slide(c, r); break;
                    case "tower": Tower(c, r); break;
                    case "version": Version(c, r); break;
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

        Console.SetOut(realOut);
        Console.WriteLine(results.ToJsonString());
    }

    static Dictionary<string, string> Fields(JsonNode n)
    {
        var d = new Dictionary<string, string>();
        foreach (var kv in n.AsObject()) d[kv.Key] = kv.Value.GetValue<string>();
        return d;
    }

    static void SetRandom(JsonNode c)
    {
        UnityEngine.Random.Script = c["random"] == null
            ? new List<int>()
            : c["random"].AsArray().Select(x => x.GetValue<int>()).ToList();
        UnityEngine.Random.Cursor = 0;
        UnityEngine.Random.Calls = new List<string>();
    }

    static VarTests ParseTests(JsonNode n)
    {
        var tests = new VarTests();
        if (n == null) return tests;
        foreach (JsonNode part in n.AsArray()) tests.Add(part.GetValue<string>());
        return tests;
    }

    static void Vars(JsonNode c, JsonObject r)
    {
        Game.Reset();
        SetRandom(c);

        VarManager vm = c["saved"] != null
            ? new VarManager(Fields(c["saved"]))
            : new VarManager();

        if (c["ops"] != null)
        {
            foreach (JsonNode op in c["ops"].AsArray())
            {
                vm.Perform(new VarOperation(op.GetValue<string>()));
            }
        }
        if (c["trim"] != null && c["trim"].GetValue<bool>()) vm.TrimQuest();
        if (c["set"] != null)
        {
            foreach (var kv in c["set"].AsObject()) vm.SetValue(kv.Key, kv.Value.GetValue<float>());
        }

        var o = new JsonObject();
        o["vars"] = DumpVars(vm);
        o["toString"] = vm.ToString().Replace(Environment.NewLine, "\n");
        if (c["get"] != null) o["get"] = (double)vm.GetValue(c["get"].GetValue<string>());
        if (c["prefix"] != null)
        {
            var prefixed = new JsonArray();
            foreach (var kv in vm.GetPrefixVars(c["prefix"].GetValue<string>()))
                prefixed.Add(new JsonArray(kv.Key, RenderFloat(kv.Value)));
            o["prefix"] = prefixed;
        }
        o["notices"] = new JsonArray(
            Game.Get().CurrentQuest.log.entries.Select(e => (JsonNode)e.content).ToArray());
        r["data"] = o;
    }

    static void Test(JsonNode c, JsonObject r)
    {
        Game.Reset();
        SetRandom(c);

        var vm = c["saved"] != null ? new VarManager(Fields(c["saved"])) : new VarManager();
        var tests = ParseTests(c["tests"]);

        var o = new JsonObject();
        o["result"] = vm.Test(tests);
        o["vars"] = DumpVars(vm);
        r["data"] = o;
    }

    static void Code(JsonNode c, JsonObject r)
    {
        SetRandom(c);
        PuzzleCode puzzle = c["saved"] != null
            ? new PuzzleCode(Fields(c["saved"]))
            : new PuzzleCode(c["items"].GetValue<int>(), c["options"].GetValue<int>(),
                             c["solution"] != null ? c["solution"].GetValue<string>() : "");

        if (c["guesses"] != null)
        {
            foreach (JsonNode g in c["guesses"].AsArray())
            {
                puzzle.AddGuess(g.AsArray().Select(x => x.GetValue<int>()).ToList());
            }
        }

        var o = new JsonObject();
        o["answer"] = puzzle.answer.ToString();
        o["solved"] = puzzle.Solved();
        o["toString"] = puzzle.ToString("1").Replace(Environment.NewLine, "\n");
        var guessInfo = new JsonArray();
        foreach (var g in puzzle.guess)
        {
            guessInfo.Add(new JsonArray(g.ToString(), g.Correct(), g.CorrectSpot(), g.CorrectType()));
        }
        o["guesses"] = guessInfo;
        r["data"] = o;
    }

    static void Image(JsonNode c, JsonObject r)
    {
        SetRandom(c);
        PuzzleImage puzzle = c["saved"] != null
            ? new PuzzleImage(Fields(c["saved"]))
            : new PuzzleImage(c["x"].GetValue<int>(), c["y"].GetValue<int>());

        var o = new JsonObject();
        o["solved"] = puzzle.Solved();
        o["toString"] = puzzle.ToString("1").Replace(Environment.NewLine, "\n");
        r["data"] = o;
    }

    static void Slide(JsonNode c, JsonObject r)
    {
        SetRandom(c);
        var puzzle = new PuzzleSlide(Fields(c["saved"]));

        var o = new JsonObject();
        o["solved"] = puzzle.Solved();
        o["toString"] = puzzle.ToString("1").Replace(Environment.NewLine, "\n");
        if (c["empty"] != null)
        {
            var checks = new JsonArray();
            foreach (JsonNode pair in c["empty"].AsArray())
            {
                int x = pair[0].GetValue<int>();
                int y = pair[1].GetValue<int>();
                checks.Add(new JsonArray(x, y, PuzzleSlide.Empty(puzzle.puzzle, x, y)));
            }
            o["empty"] = checks;
        }
        r["data"] = o;
    }

    static void Tower(JsonNode c, JsonObject r)
    {
        SetRandom(c);
        PuzzleTower puzzle = c["saved"] != null
            ? new PuzzleTower(Fields(c["saved"]))
            : new PuzzleTower(c["depth"].GetValue<int>());

        if (c["moves"] != null)
        {
            foreach (JsonNode m in c["moves"].AsArray())
            {
                puzzle.Move(m[0].GetValue<int>(), m[1].GetValue<int>());
            }
        }

        var o = new JsonObject();
        o["solved"] = puzzle.Solved();
        o["toString"] = puzzle.ToString("1").Replace(Environment.NewLine, "\n");
        var state = new JsonArray();
        foreach (var tower in puzzle.puzzle)
            state.Add(new JsonArray(tower.Select(x => (JsonNode)x).ToArray()));
        o["state"] = state;

        if (c["countStates"] != null)
        {
            o["stateCount"] = TowerProbe.CountStates(c["countStates"].GetValue<int>());
        }
        r["data"] = o;
    }

    // VersionManager comparison plus the Android version-code generator.
    static void Version(JsonNode c, JsonObject r)
    {
        string a = c["a"].GetValue<string>();
        string b = c["b"] != null ? c["b"].GetValue<string>() : "";

        var o = new JsonObject();
        o["isBetaA"] = VersionManager.IsBeta(a);
        o["isBetaB"] = VersionManager.IsBeta(b);
        o["newer"] = VersionManager.VersionNewer(a, b);
        o["newerOrEqual"] = VersionManager.VersionNewerOrEqual(a, b);
        o["codeA"] = SetVersionProbe.VersionCodeGenerate(a);
        o["codeB"] = SetVersionProbe.VersionCodeGenerate(b);
        r["data"] = o;
    }

    static JsonArray DumpVars(VarManager vm)
    {
        var arr = new JsonArray();
        foreach (var kv in vm.vars) arr.Add(new JsonArray(kv.Key, RenderFloat(kv.Value)));
        return arr;
    }

    static JsonNode RenderFloat(float f)
    {
        if (float.IsNaN(f)) return "NaN";
        if (float.IsInfinity(f)) return f > 0 ? "Infinity" : "-Infinity";
        return (double)f;
    }
}

/// <summary>Exposes PuzzleTower's protected search so the state space can be compared.</summary>
class TowerProbe : PuzzleTower
{
    private TowerProbe() : base(new Dictionary<string, string>()) { }

    public static int CountStates(int depth)
    {
        return new TowerProbe().BuildPuzzles(depth).Count;
    }
}
