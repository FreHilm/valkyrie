// Drives the extracted TraitGroup exactly as the selection list does: build the
// groups from the items, apply the selected/excluded states, then ask which
// items stay active.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

class Program
{
    static void Main()
    {
        var cases = JsonDocument.Parse(Console.In.ReadToEnd()).RootElement;
        var results = new List<object>();

        foreach (var c in cases.EnumerateArray())
        {
            var items = new List<Extracted.SelectionItemTraits>();
            foreach (var i in c.GetProperty("items").EnumerateArray())
            {
                var traits = new Dictionary<string, IEnumerable<string>>();
                foreach (var g in i.GetProperty("traits").EnumerateObject())
                {
                    traits[g.Name] = g.Value.EnumerateArray().Select(v => v.GetString()).ToList();
                }
                items.Add(new Extracted.SelectionItemTraits(
                    i.GetProperty("display").GetString(),
                    i.GetProperty("key").GetString(),
                    traits));
            }

            // The constructor reads CommonStringKeys.SOURCE.Translate(), which
            // the shim answers — so the real mode-selection code runs.
            StringKeyStub.Wording = c.GetProperty("sourceWording").GetString();

            // Mirrors UIWindowSelectionListTraits.Draw() exactly: AddTraits is
            // called only for a group matching one of the item's own trait
            // categories (which is why its unguarded lookup never throws
            // there), and only afterwards is AddItem called for every pair.
            var groups = new List<Extracted.TraitGroup>();
            foreach (var item in items)
            {
                foreach (string category in item.GetTraits().Keys)
                {
                    bool found = false;
                    foreach (var tg in groups)
                    {
                        if (tg.GetName().Equals(category)) { found = true; tg.AddTraits(item); }
                    }
                    if (!found)
                    {
                        var tg = new Extracted.TraitGroup(category);
                        tg.AddTraits(item);
                        groups.Add(tg);
                    }
                }
            }

            foreach (var item in items)
            {
                foreach (var tg in groups) tg.AddItem(item);
            }

            foreach (var s in c.GetProperty("states").EnumerateArray())
            {
                var group = groups.FirstOrDefault(g => g.GetName() == s.GetProperty("group").GetString());
                if (group == null) continue;
                string trait = s.GetProperty("trait").GetString();
                if (!group.traits.ContainsKey(trait)) continue;
                group.traits[trait].selected = s.GetProperty("selected").GetBoolean();
                group.traits[trait].excluded = s.GetProperty("excluded").GetBoolean();
            }

            var active = new List<string>();
            foreach (var item in items)
            {
                bool visible = true;
                foreach (var group in groups)
                {
                    if (!item.GetTraits().ContainsKey(group.GetName())) continue;
                    if (!group.ActiveItem(item)) { visible = false; break; }
                }
                if (visible) active.Add(item.GetKey());
            }

            results.Add(new { label = c.GetProperty("label").GetString(), active });
        }

        Console.WriteLine(JsonSerializer.Serialize(results));
    }
}
