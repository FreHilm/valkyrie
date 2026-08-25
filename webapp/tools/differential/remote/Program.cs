// Runs the unmodified RemoteContentPack.cs over the shared corpus.
// Cases in on stdin as JSON, one result object per case out on stdout.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using Assets.Scripts.Content;

class Program
{
    static readonly string[] Languages = { "English", "German", "Spanish", "French", "Missing" };

    static void Main(string[] args)
    {
        // The harness pins the culture so a run is reproducible; the locale
        // sensitivity of DateTime.TryParse is measured separately.
        var culture = args.Length > 0 ? new CultureInfo(args[0]) : CultureInfo.InvariantCulture;
        CultureInfo.CurrentCulture = culture;
        CultureInfo.DefaultThreadCurrentCulture = culture;

        var cases = JsonDocument.Parse(Console.In.ReadToEnd()).RootElement;
        var results = new List<object>();

        foreach (var c in cases.EnumerateArray())
        {
            var fields = new Dictionary<string, string>();
            foreach (var kv in c.GetProperty("fields").EnumerateObject())
            {
                fields[kv.Name] = kv.Value.GetString();
            }

            string identifier = c.GetProperty("identifier").GetString();
            object row;
            try
            {
                var pack = new RemoteContentPack(identifier, fields);
                var titles = new Dictionary<string, string>();
                var descriptions = new Dictionary<string, string>();
                foreach (var lang in Languages)
                {
                    titles[lang] = pack.GetTitle(lang);
                    descriptions[lang] = pack.GetDescription(lang);
                }

                row = new
                {
                    label = c.GetProperty("label").GetString(),
                    identifier = pack.identifier,
                    valid = pack.valid,
                    type = pack.type,
                    image = pack.image,
                    version = pack.version,
                    package_url = pack.package_url,
                    // Round-trip in UTC so the two sides are comparable.
                    latest_update = pack.latest_update.ToUniversalTime()
                        .ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture),
                    latest_update_kind = pack.latest_update.Kind.ToString(),
                    names = pack.languages_name,
                    descriptions_map = pack.languages_description,
                    titles,
                    descriptions,
                    error = (string)null,
                };
            }
            catch (Exception e)
            {
                row = new { label = c.GetProperty("label").GetString(), error = e.GetType().Name };
            }

            results.Add(row);
        }

        Console.WriteLine(JsonSerializer.Serialize(results));
    }
}
