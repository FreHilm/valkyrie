namespace ValkyrieTools
{
    public class ValkyrieDebug
    {
        public static bool enabled { get; set; } = true;
        public static System.Collections.Generic.List<string> Messages = new System.Collections.Generic.List<string>();
        public static void Log(object message)
        {
            if (enabled) Messages.Add(message?.ToString());
        }
    }
}
