// Stand-ins for the two things the extracted classes reach for that are not
// in the extract. `CommonStringKeys.SOURCE.Translate()` returns whatever the
// harness sets, so the Source-group behaviour can be driven from a case.
using System;

public class StringKeyStub
{
    public static string Wording = "Source";
    public string Translate() { return Wording; }
}

public static class CommonStringKeys
{
    public static readonly StringKeyStub SOURCE = new StringKeyStub();
}
