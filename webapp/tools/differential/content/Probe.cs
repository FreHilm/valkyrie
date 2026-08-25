using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json.Nodes;
using Assets.Scripts.Content;

/// <summary>
/// Reaches the private members of the unmodified content sources by reflection,
/// so nothing under test has to be edited to be testable.
///
/// The dumper walks public fields and properties reflectively rather than
/// listing them by hand, so a field the port forgot still shows up as a
/// difference instead of being silently skipped.
/// </summary>
public class ContentDataProbe
{
    public readonly ContentData Cd;
    private readonly ContentLoader loader;
    private readonly MethodInfo loadContent;
    private static readonly string EmptyDir = MakeEmptyDir();

    private static string MakeEmptyDir()
    {
        string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "valkyrie-content-probe");
        System.IO.Directory.CreateDirectory(dir);
        return dir;
    }

    public ContentDataProbe()
    {
        Cd = new ContentData(EmptyDir);
        loader = new ContentLoader(Cd);
        loadContent = typeof(ContentLoader).GetMethod(
            "LoadContent",
            BindingFlags.Instance | BindingFlags.NonPublic,
            null,
            new[] { typeof(string), typeof(Dictionary<string, string>), typeof(string), typeof(string) },
            null);
    }

    public void LoadOne(string name, Dictionary<string, string> content, string path, string packId)
    {
        try
        {
            loadContent.Invoke(loader, new object[] { name, content, path, packId });
        }
        catch (TargetInvocationException e)
        {
            throw e.InnerException ?? e;
        }
    }

    public static ContentPack ProbeGetPackData(string path, string gameTypeName, bool checkGameType)
    {
        var m = typeof(ContentData).GetMethod("GetPackData", BindingFlags.Static | BindingFlags.NonPublic);
        try
        {
            return (ContentPack)m.Invoke(null, new object[] { path, gameTypeName, checkGameType });
        }
        catch (TargetInvocationException e)
        {
            throw e.InnerException ?? e;
        }
    }

    /// <summary>Ordered dump of the whole registry: [[typeName, [[key, fields]]]].</summary>
    public JsonArray Dump()
    {
        var field = typeof(ContentData).GetField("Content", BindingFlags.Instance | BindingFlags.NonPublic);
        var content = (Dictionary<Type, Dictionary<string, IContent>>)field.GetValue(Cd);

        var outer = new JsonArray();
        foreach (var typeEntry in content.OrderBy(kv => kv.Key.Name, StringComparer.Ordinal))
        {
            // Peril is excluded: PerilData extends QuestData.Event, which is a
            // harness stub until T-008.
            if (typeEntry.Key.Name == "PerilData") continue;

            var entries = new JsonArray();
            foreach (var kv in typeEntry.Value.OrderBy(kv => kv.Key, StringComparer.Ordinal))
            {
                entries.Add(new JsonArray(kv.Key, DumpObject(kv.Value)));
            }
            outer.Add(new JsonArray(typeEntry.Key.Name, entries));
        }
        return outer;
    }

    private static readonly HashSet<string> Skipped = new HashSet<string>
    {
        // Static "type" shadowing per subclass; not per-instance state.
        "type",
    };

    private static JsonObject DumpObject(object o)
    {
        var result = new JsonObject();
        var t = o.GetType();

        foreach (var f in t.GetFields(BindingFlags.Instance | BindingFlags.Public)
                           .OrderBy(f => f.Name, StringComparer.Ordinal))
        {
            if (Skipped.Contains(f.Name)) continue;
            result[f.Name] = Render(f.GetValue(o));
        }

        foreach (var p in t.GetProperties(BindingFlags.Instance | BindingFlags.Public)
                           .OrderBy(p => p.Name, StringComparer.Ordinal))
        {
            if (Skipped.Contains(p.Name) || p.GetIndexParameters().Length > 0) continue;
            result[p.Name] = Render(p.GetValue(o));
        }

        return result;
    }

    private static JsonNode Render(object v)
    {
        if (v == null) return null;
        if (v is StringKey sk) return sk.fullKey;
        if (v is string s) return s;
        if (v is bool b) return b;
        if (v is int i) return i;
        // Exact double value of the float32, so JSON numbers compare exactly
        // against Math.fround on the TypeScript side. NaN and the infinities
        // are not valid JSON numbers, so they go out as strings.
        if (v is float f)
        {
            if (float.IsNaN(f)) return "NaN";
            if (float.IsPositiveInfinity(f)) return "Infinity";
            if (float.IsNegativeInfinity(f)) return "-Infinity";
            return (double)f;
        }
        if (v is double d)
        {
            if (double.IsNaN(d)) return "NaN";
            if (double.IsPositiveInfinity(d)) return "Infinity";
            if (double.IsNegativeInfinity(d)) return "-Infinity";
            return d;
        }
        if (v is IEnumerable e)
        {
            var arr = new JsonArray();
            foreach (var item in e) arr.Add(Render(item));
            return arr;
        }
        return v.ToString();
    }
}
