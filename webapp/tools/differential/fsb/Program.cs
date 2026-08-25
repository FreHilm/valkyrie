// Runs the unmodified FSBExport over real .fsb files and writes the .ogg it
// produces, so the port can be compared against it byte for byte.
using System;
using System.IO;

class Program
{
    static void Main(string[] args)
    {
        string inDir = args[0];
        string outDir = args[1];
        Directory.CreateDirectory(outDir);

        int written = 0, failed = 0;
        foreach (var path in Directory.GetFiles(inDir, "*.fsb"))
        {
            string target = Path.Combine(outDir, Path.GetFileNameWithoutExtension(path) + ".ogg");
            try
            {
                FSBExport.Write(File.ReadAllBytes(path), target);
                if (File.Exists(target)) written++;
            }
            catch (Exception e)
            {
                failed++;
                if (failed <= 3) Console.Error.WriteLine($"{Path.GetFileName(path)}: {e.GetType().Name}: {e.Message}");
            }
        }
        Console.WriteLine($"FSBExport wrote {written} files, {failed} failed");
    }
}
