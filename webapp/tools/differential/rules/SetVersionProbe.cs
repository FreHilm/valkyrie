// VersionCodeGenerate copied verbatim from libraries/SetVersion/Program.cs,
// with only the accessibility widened so the harness can call it.
using System;

public static class SetVersionProbe
{
public static string VersionCodeGenerate(string version)
        {
            if (version.Length == 0)
            {
                Console.WriteLine("No version found to convert.");
                return "0";
            }
            if (version.Length == 1)
            {
                if (Char.IsDigit(version[0]))
                {
                    return version;
                }
                Console.WriteLine("Version does not include a number.");
                return "0";
            }

            // We don't handle more than 1 trailing alpha
            for (int i = 0; i < (version.Length - 1); i++)
            {
                if (!Char.IsDigit(version[i]) && version[i] != '.')
                {
                    Console.WriteLine("Version has letters (other than a single final little).");
                    return "0";
                }
            }

            int majorDot = version.IndexOf('.');
            string majorString = version;
            string minorString = "0";
            string patchString = "0";
            if (majorDot != -1)
            {
                majorString = version.Substring(0, majorDot);

                int minorDot = version.IndexOf('.', majorDot + 1);
                minorString = version.Substring(majorDot + 1);
                {
                    if (minorDot != -1)
                    {
                        minorString = version.Substring(majorDot + 1, minorDot - (majorDot + 1));
                        patchString = version.Substring(minorDot + 1);
                        {
                            if (!Char.IsDigit(version[version.Length - 1]))
                            {
                                patchString = patchString.Substring(0, patchString.Length - 1);
                            }
                        }
                    }
                }
            }

            int majorNumber = 0;
            int minorNumber = 0;
            int patchNumber = 0;
            int VersionComponentChar = 0;

            if (!int.TryParse(majorString, out majorNumber))
            {
                Console.WriteLine("Error reading major version: " + majorString + ".");
                return "0";
            }
            if (!int.TryParse(minorString, out minorNumber))
            {
                Console.WriteLine("Error reading minor version: " + minorString + ".");
                return "0";
            }
            if (!int.TryParse(patchString, out patchNumber))
            {
                Console.WriteLine("Error reading patch version: " + patchString + ".");
                return "0";
            }

            if (!Char.IsDigit(version[version.Length - 1]))
            {
                 Console.WriteLine("Version does not end in a digit (suffixes not supported).");
                 return "0";
            }

            int versionCode = VersionComponentChar;
            versionCode += patchNumber * 10;
            versionCode += minorNumber * 10000;
            versionCode += majorNumber * 10000000;

            if (versionCode > 2100000000)
            {
                Console.WriteLine("Version exceeds android limit.");
                return "0";
            }
            return versionCode.ToString();
        }
}
