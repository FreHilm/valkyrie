// Stand-ins for the Unity and game-runtime dependencies of the content sources.
//
// None of these contain ported logic. They exist only so that
// ContentTypes.cs, ContentData.cs, ContentLoader.cs and ContentPack.cs compile
// unmodified. The harness never calls the texture or filesystem paths.
//
// The two knobs the harness *does* set are Game.TilePixelPerSquare and
// Game.AppDataPath, because TileSideData and ContentData.ImportPath read them
// while parsing.

using System;
using System.Collections.Generic;

namespace UnityEngine
{
    public static class Debug
    {
        public static void Log(object message) { }
        public static void Log(object message, object context) { }
    }

    public class Object { }

    public enum RuntimePlatform { WindowsPlayer, OSXPlayer, LinuxPlayer, Android }

    public enum TextureFormat
    {
        DXT1, DXT5, RGB24, RGBA32, BGRA32, ARGB32, ETC_RGB4, ETC2_RGBA8, ETC2_RGB, RGB565, Alpha8,
        PVRTC_RGB4, PVRTC_RGBA4, PVRTC_RGB2, PVRTC_RGBA2,
    }

    public struct Vector2
    {
        public float x, y;
        public Vector2(float x, float y) { this.x = x; this.y = y; }
        public static Vector2 zero { get { return new Vector2(0, 0); } }
    }

    public class Texture2D
    {
        public int width, height;
        public Texture2D(int w, int h) { width = w; height = h; }
        public Texture2D(int w, int h, TextureFormat f, bool mip) { width = w; height = h; }
        public Texture2D(int w, int h, TextureFormat f, int mips, bool linear) { width = w; height = h; }
        public Texture2D(int w, int h, TextureFormat f, bool mip, bool linear) { width = w; height = h; }
        public void LoadRawTextureData(byte[] data) { }
        public void LoadRawTextureData(IntPtr p, int size) { }
        public void SetPixels(Color[] c) { }
        public void SetPixels32(Color32[] c) { }
        public Color[] GetPixels(int x, int y, int w, int h) { return new Color[0]; }
        public Color32[] GetPixels32() { return new Color32[0]; }
        public void Apply() { }
        public bool LoadImage(byte[] data) { return true; }
        public string name { get; set; }
        public object filterMode { get; set; }
    }

    public struct Color { public float r, g, b, a; }
    public struct Color32
    {
        public byte r, g, b, a;
        public Color32(byte r, byte g, byte b, byte a) { this.r = r; this.g = g; this.b = b; this.a = a; }
    }

    public static class Mathf
    {
        public static int RoundToInt(float f) { return (int)Math.Round(f); }
        public static int Max(int a, int b) { return Math.Max(a, b); }
        public static int Min(int a, int b) { return Math.Min(a, b); }
    }

    public static class Application
    {
        public static RuntimePlatform platform = RuntimePlatform.OSXPlayer;
        public static string persistentDataPath = "/persistent";
        public static string streamingAssetsPath = "/streaming";
        public static bool isEditor = false;
        public static void Quit() { throw new HarnessQuitException(); }
    }

    public class HarnessQuitException : Exception { }

    public static class Random
    {
        public static int Range(int min, int max) { return min; }
    }
}

namespace UnityEngine.Networking
{
    public class UnityWebRequest : System.IDisposable
    {
        public static UnityWebRequest Get(string uri) { return new UnityWebRequest(); }
        public AsyncOp SendWebRequest() { return new AsyncOp(); }
        public bool isNetworkError, isHttpError;
        public string error = "";
        public DownloadHandlerStub downloadHandler = new DownloadHandlerStub();
        public void Dispose() { }
    }
    public class AsyncOp { public bool isDone = true; }
    public class DownloadHandlerStub { public byte[] data = new byte[0]; public string text = ""; }

    public static class UnityWebRequestTexture
    {
        public static UnityWebRequest GetTexture(string uri) { return new UnityWebRequest(); }
    }

    public static class DownloadHandlerTexture
    {
        public static UnityEngine.Texture2D GetContent(UnityWebRequest r)
        {
            return new UnityEngine.Texture2D(1, 1);
        }
    }
}

// LinqUtil.ToSet, used by the real FormatVersions.cs.
public static class LinqUtil
{
    public static System.Collections.Generic.HashSet<T> ToSet<T>(this System.Collections.Generic.IEnumerable<T> source)
    {
        return new System.Collections.Generic.HashSet<T>(source);
    }
}

namespace ValkyrieTools
{
    public class ValkyrieDebug
    {
        public static bool enabled { get; set; } = false;
        public static void Log(object message) { }
        public static void Log(object message, UnityEngine.Object context) { }
    }
}

public static class ValkyrieConstants
{
    public const string DefaultLanguage = "English";
    public const string ContentPackIniFile = "content_pack.ini";
    public const string ContentPackDownloadContainerExtension = ".valkyrieContentPack";
    public const string ContentPackDownloadContainerExtensionAllFileReference = "*.valkyrieScenario";
    public const string PackType = "PackType";
    public const string typeMom = "MoM";
    public const string typeDescent = "D2E";
}

public class GameTypeStub
{
    public float pps = 105f;
    public string typeName = "D2E";
    public float TilePixelPerSquare() { return pps; }
    public string TypeName() { return typeName; }
    public string DataDirectory() { return "/content"; }
}

public class Game
{
    public static GameTypeStub StaticGameType = new GameTypeStub();
    public static string AppDataPath = "/appdata";

    public string currentLang = "English";
    public string fallbackLang = "";
    public GameTypeStub gameType = StaticGameType;
    public ContentData cd;

    private static Game instance;
    public static Game Get() { return instance; }
    public static void SetInstance(Game g) { instance = g; }
    public static string AppData() { return AppDataPath; }
}

// PerilData extends QuestData.Event. QuestData is ported in T-008, so this is
// only enough to compile; Peril sections are excluded from the comparison.
public class QuestData
{
    public class Quest { public static int currentFormat = 21; }

    public class Event
    {
        public string sectionName;
        public string typeDynamic = "";
        public virtual Assets.Scripts.Content.StringKey text { get; }
        public Event(string name, Dictionary<string, string> data, string path, int format)
        {
            sectionName = name;
        }
    }
}

namespace Assets.Scripts.Content
{
    public class VarTests { }
    public class VarOperation { }

    public class ExtractManager
    {
        public static string ExtractSinglePackageFull(string path) { return path; }
    }

    public class ManifestManager
    {
        public ManifestManager(string path) { }
        public ValkyrieTools.IniData GetLocalContentPackManifestIniData() { return new ValkyrieTools.IniData(); }
    }
}
