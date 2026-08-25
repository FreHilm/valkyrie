// Minimal stand-ins so AssetStudio compiles outside Unity/Valkyrie.
namespace ValkyrieTools
{
    public static class ValkyrieDebug
    {
        public static bool enabled = false;
        public static void Log(string message) { if (enabled) System.Console.Error.WriteLine(message); }
    }
}

namespace FFGAppImport
{
    /// The real FetchContent drives the import; the probe only needs the
    /// callback's shape so AssetsManager compiles.
    public class FetchContent
    {
        public virtual void ImportAssetPreloadData(AssetStudio.Object assetPreloadData) { }
    }
}
