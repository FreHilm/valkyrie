// Minimal stand-ins for the Unity types RemoteContentPack.cs touches, so the
// unmodified source compiles. Only ToString() needs Game, and the harness does
// not call it.
namespace ValkyrieTools
{
    public static class ValkyrieDebug
    {
        public static bool enabled = false;
        public static void Log(string message) { }
    }
}

public static class ValkyrieConstants
{
    public const string DefaultLanguage = "English";
    public const string RemoteContentPackIniType = "RemoteContentPack";
}

public class GameType
{
    public string TypeName() { return "D2E"; }
}

public class Game
{
    public GameType gameType = new GameType();
    private static readonly Game instance = new Game();
    public static Game Get() { return instance; }
}
