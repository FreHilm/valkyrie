// Runs the extracted symbol replacement over the shared corpus.
using System;
using System.Collections.Generic;
using System.Text.Json;

class Program
{
    static void Main()
    {
        var cases = JsonDocument.Parse(Console.In.ReadToEnd()).RootElement;
        var results = new List<object>();

        foreach (var c in cases.EnumerateArray())
        {
            Game.Reset();
            Game.Get().gameType.Name = c.GetProperty("gameType").GetString();
            foreach (var kv in c.GetProperty("vars").EnumerateObject())
            {
                Game.Get().CurrentQuest.vars.Values[kv.Name] = (float)kv.Value.GetDouble();
            }

            string input = c.GetProperty("input").GetString();
            string output = null, roundTrip = null, error = null;
            try
            {
                output = EventManager.OutputSymbolReplace(input);
                roundTrip = EventManager.InputSymbolReplace(output);
            }
            catch (Exception e)
            {
                error = e.GetType().Name;
            }

            results.Add(new
            {
                label = c.GetProperty("label").GetString(),
                output,
                roundTrip,
                warnings = Game.Get().CurrentQuest.log.Entries.Count,
                error,
            });
        }

        Console.WriteLine(JsonSerializer.Serialize(results));
    }
}
