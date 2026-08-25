// Reads a real FFG app's Unity data with the vendored AssetStudio and reports
// what is actually in there: asset types, texture formats, audio formats.
// Answers T-001 and T-002 by measurement rather than by reading source.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using AssetStudio;

class Program
{
    /// Writes textures as .dds and audio as .fsb, byte-identical to what
    /// FetchContent.ExportTexture does — so the web port can be compared
    /// against the same inputs the Unity build works from.
    static void ExportAll(AssetsManager manager, string exportDir, int limit)
    {
        string img = Path.Combine(exportDir, "img");
        string audio = Path.Combine(exportDir, "audio");
        string text = Path.Combine(exportDir, "text");
        Directory.CreateDirectory(img);
        Directory.CreateDirectory(audio);
        Directory.CreateDirectory(text);

        int textures = 0, clips = 0;
        var seen = new HashSet<string>();

        foreach (var assetsFile in manager.assetsFileList)
        {
            foreach (var obj in assetsFile.Objects)
            {
                try
                {
                    if (obj is Texture2D tex && textures < limit)
                    {
                        string name = Safe(tex.m_Name, $"tex{textures}");
                        if (!seen.Add("t:" + name + tex.m_TextureFormat)) continue;
                        string path = Path.Combine(img, $"{name}.{tex.m_TextureFormat}.dds");
                        WriteDds(path, tex);
                        textures++;
                    }
                    else if (obj is AssetStudio.TextAsset ta)
                    {
                        string name = Safe(ta.m_Name, "text");
                        if (!seen.Add("x:" + name)) continue;
                        File.WriteAllBytes(Path.Combine(text, name + ".txt"),
                            ta.Deobfuscate(68264378));
                    }
                    else if (obj is AudioClip clip && clips < limit)
                    {
                        string name = Safe(clip.m_Name, $"clip{clips}");
                        if (!seen.Add("a:" + name)) continue;
                        var data = clip.m_AudioData.GetData();
                        if (data == null || data.Length == 0) continue;
                        File.WriteAllBytes(Path.Combine(audio, $"{name}.fsb"), data);
                        clips++;
                    }
                }
                catch (Exception e)
                {
                    Console.Error.WriteLine($"  export failed: {e.GetType().Name}: {e.Message}");
                }
            }
        }

        Console.WriteLine($"\nexported {textures} textures and {clips} audio clips to {exportDir}");
    }

    /// Ground truth for the TypeScript reader: every object the importer cares
    /// about, with the identity and payload hash the port must reproduce.
    static void WriteManifest(AssetsManager manager, string exportDir)
    {
        var entries = new List<object>();

        foreach (var assetsFile in manager.assetsFileList)
        {
            string file = Path.GetFileName(assetsFile.fullName);
            foreach (var obj in assetsFile.Objects)
            {
                try
                {
                    if (obj is Texture2D tex)
                    {
                        entries.Add(new
                        {
                            file,
                            pathId = obj.m_PathID.ToString(),
                            cls = "Texture2D",
                            name = tex.m_Name,
                            width = tex.m_Width,
                            height = tex.m_Height,
                            format = tex.m_TextureFormat.ToString(),
                            mips = tex.dwMipMapCount,
                            sha = Sha(tex.image_data_bytes),
                            size = tex.image_data_bytes?.Length ?? 0,
                        });
                    }
                    else if (obj is AudioClip clip)
                    {
                        var data = clip.m_AudioData.GetData();
                        entries.Add(new
                        {
                            file,
                            pathId = obj.m_PathID.ToString(),
                            cls = "AudioClip",
                            name = clip.m_Name,
                            channels = clip.m_Channels,
                            frequency = clip.m_Frequency,
                            format = clip.m_CompressionFormat.ToString(),
                            sha = Sha(data),
                            size = data?.Length ?? 0,
                        });
                    }
                    else if (obj is TextAsset text)
                    {
                        entries.Add(new
                        {
                            file,
                            pathId = obj.m_PathID.ToString(),
                            cls = "TextAsset",
                            name = text.m_Name,
                            sha = Sha(text.m_Script),
                            size = text.m_Script?.Length ?? 0,
                        });
                    }
                }
                catch (Exception e)
                {
                    Console.Error.WriteLine($"  manifest failed for {obj.type}: {e.GetType().Name}");
                }
            }
        }

        string path = Path.Combine(exportDir, "manifest.json");
        File.WriteAllText(path, JsonSerializer.Serialize(entries));
        Console.WriteLine($"manifest: {entries.Count} objects -> {path}");
    }

    static string Sha(byte[] data)
    {
        if (data == null) return "";
        using var sha = SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(data)).ToLowerInvariant();
    }

    static string Safe(string name, string fallback)
    {
        if (string.IsNullOrWhiteSpace(name)) return fallback;
        foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        return name.Replace(' ', '_');
    }

    /// The exact header FetchContent.ExportTexture builds.
    static void WriteDds(string fileName, Texture2D texture2D)
    {
        using var fs = File.Open(fileName, FileMode.Create);
        using var writer = new BinaryWriter(fs);
        writer.Write(0x20534444);
        writer.Write(0x7C);
        writer.Write(texture2D.dwFlags);
        writer.Write(texture2D.m_Height);
        writer.Write(texture2D.m_Width);
        writer.Write(texture2D.dwPitchOrLinearSize);
        writer.Write((int)0);
        writer.Write(texture2D.dwMipMapCount);
        writer.Write(new byte[44]);
        writer.Write(texture2D.dwSize);
        writer.Write(texture2D.dwFlags2);
        writer.Write(texture2D.dwFourCC);
        writer.Write(texture2D.dwRGBBitCount);
        writer.Write(texture2D.dwRBitMask);
        writer.Write(texture2D.dwGBitMask);
        writer.Write(texture2D.dwBBitMask);
        writer.Write(texture2D.dwABitMask);
        writer.Write(texture2D.dwCaps);
        writer.Write(texture2D.dwCaps2);
        writer.Write(new byte[12]);
        writer.Write(texture2D.image_data_bytes);
    }

    static void Main(string[] args)
    {
        string dataDir = args[0];
        // Optional second argument: a directory to export assets into. It must
        // be outside the repository — these are the user's licensed content.
        string exportDir = args.Length > 1 ? args[1] : null;
        int exportLimit = args.Length > 2 ? int.Parse(args[2]) : int.MaxValue;
        // Downloaded content arrives as UnityFS AssetBundles named "__data",
        // so those are picked up as well as the install's SerializedFiles.
        var files = Directory.GetFiles(dataDir, "*", SearchOption.AllDirectories)
            .Where(f => f.EndsWith(".assets") || Path.GetFileName(f).StartsWith("level")
                        || Path.GetFileName(f) == "globalgamemanagers"
                        || Path.GetFileName(f) == "__data")
            .OrderBy(f => f)
            .ToArray();

        Console.Error.WriteLine($"loading {files.Length} files from {dataDir}");

        var manager = new AssetsManager();
        try
        {
            manager.LoadFiles(files);
        }
        catch (Exception e)
        {
            Console.WriteLine($"LOAD FAILED: {e.GetType().Name}: {e.Message}");
            Console.WriteLine(e.StackTrace);
            return;
        }

        Console.WriteLine($"loaded assetsFileList: {manager.assetsFileList.Count}");
        foreach (var f in manager.assetsFileList)
        {
            Console.WriteLine($"  {Path.GetFileName(f.fullName)}  unityVersion={f.unityVersion}  format={f.header.m_Version}  objects={f.Objects.Count}");
        }

        var byType = new Dictionary<string, int>();
        var textureFormats = new Dictionary<string, int>();
        var audioFormats = new Dictionary<string, int>();
        long textureBytes = 0;
        var textureSamples = new List<string>();
        var audioSamples = new List<string>();

        foreach (var assetsFile in manager.assetsFileList)
        {
            foreach (var obj in assetsFile.Objects)
            {
                string type = obj.type.ToString();
                byType[type] = byType.GetValueOrDefault(type) + 1;

                try
                {
                    if (obj is Texture2D tex)
                    {
                        string fmt = tex.m_TextureFormat.ToString();
                        textureFormats[fmt] = textureFormats.GetValueOrDefault(fmt) + 1;
                        textureBytes += tex.m_StreamData != null && tex.m_StreamData.size > 0
                            ? (long)tex.m_StreamData.size : (tex.image_data != null ? tex.image_data.Size : 0);
                        if (textureSamples.Count < 12)
                            textureSamples.Add($"{tex.m_Name} {tex.m_Width}x{tex.m_Height} {fmt}");
                    }
                    else if (obj is AudioClip clip)
                    {
                        string fmt = clip.m_CompressionFormat.ToString();
                        audioFormats[fmt] = audioFormats.GetValueOrDefault(fmt) + 1;
                        if (audioSamples.Count < 8)
                            audioSamples.Add($"{clip.m_Name} {clip.m_Channels}ch {clip.m_Frequency}Hz {fmt}");
                    }
                }
                catch (Exception e)
                {
                    Console.Error.WriteLine($"  object read failed: {type}: {e.GetType().Name}");
                }
            }
        }

        Console.WriteLine("\n=== object types ===");
        foreach (var kv in byType.OrderByDescending(k => k.Value).Take(20))
            Console.WriteLine($"  {kv.Key,-24} {kv.Value}");

        Console.WriteLine("\n=== texture formats ===");
        foreach (var kv in textureFormats.OrderByDescending(k => k.Value))
            Console.WriteLine($"  {kv.Key,-24} {kv.Value}");
        Console.WriteLine($"  total texture bytes: {textureBytes:N0}");
        Console.WriteLine("  samples:");
        foreach (var s in textureSamples) Console.WriteLine($"    {s}");

        if (exportDir != null)
        {
            ExportAll(manager, exportDir, exportLimit);
            WriteManifest(manager, exportDir);
        }

        Console.WriteLine("\n=== audio formats ===");
        foreach (var kv in audioFormats.OrderByDescending(k => k.Value))
            Console.WriteLine($"  {kv.Key,-24} {kv.Value}");
        foreach (var s in audioSamples) Console.WriteLine($"    {s}");
    }
}
