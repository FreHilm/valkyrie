// Runs the extracted Quest.FindLocalisedMultimediaFile over the shared corpus.
// Reads cases as JSON on stdin, writes one result per line on stdout.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

class Program
{
    static void Main()
    {
        var cases = JsonDocument.Parse(Console.In.ReadToEnd()).RootElement;
        var results = new List<object>();

        foreach (var c in cases.EnumerateArray())
        {
            string root = Path.Combine(Path.GetTempPath(), "vk_mm_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            try
            {
                foreach (var f in c.GetProperty("files").EnumerateArray())
                {
                    string full = Path.Combine(root, f.GetString().Replace('/', Path.DirectorySeparatorChar));
                    Directory.CreateDirectory(Path.GetDirectoryName(full));
                    File.WriteAllText(full, string.Empty);
                }

                string name = c.GetProperty("name").GetString();
                string fallback = c.GetProperty("fallbackLang").ValueKind == JsonValueKind.Null
                    ? null : c.GetProperty("fallbackLang").GetString();

                string value;
                string error = null;
                try
                {
                    value = Quest.FindLocalisedMultimediaFile(
                        name.Replace('/', Path.DirectorySeparatorChar),
                        root,
                        c.GetProperty("currentLang").GetString(),
                        fallback,
                        c.GetProperty("editMode").GetBoolean());
                    // Report relative to the temp root, with forward slashes,
                    // so the two sides are comparable.
                    value = value.StartsWith(root)
                        ? value.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar, '/')
                        : value;
                    value = value.Replace(Path.DirectorySeparatorChar, '/');
                }
                catch (Exception e)
                {
                    value = null;
                    error = e.GetType().Name;
                }

                results.Add(new { label = c.GetProperty("label").GetString(), value, error });
            }
            finally
            {
                try { Directory.Delete(root, true); } catch { }
            }
        }

        Console.WriteLine(JsonSerializer.Serialize(results));
    }
}
