// Runs the vendored .NET Ogg Vorbis Encoder over the same inputs as the port,
// reproducing exactly what FSBExport.WriteFile does with it: build the two
// header packets, frame everything into Ogg pages, emit the bytes.
//
// Cases in as JSON on stdin, base64 Ogg bytes out on stdout.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using OggVorbisEncoder;

class Program
{
    static void Main()
    {
        var cases = JsonDocument.Parse(Console.In.ReadToEnd()).RootElement;
        var results = new List<object>();

        foreach (var c in cases.EnumerateArray())
        {
            try
            {
                results.Add(new { label = c.GetProperty("label").GetString(), bytes = Run(c), error = (string)null });
            }
            catch (Exception e)
            {
                results.Add(new { label = c.GetProperty("label").GetString(), bytes = (string)null, error = e.GetType().Name });
            }
        }

        Console.WriteLine(JsonSerializer.Serialize(results));
    }

    static string Run(JsonElement c)
    {
        int channels = c.GetProperty("channels").GetInt32();
        int frequency = c.GetProperty("frequency").GetInt32();
        uint loopStart = c.GetProperty("loopStart").GetUInt32();
        uint loopEnd = c.GetProperty("loopEnd").GetUInt32();

        // Exactly as FSBExport.WriteFile sets these up.
        HeaderPacketBuilder hpb = new HeaderPacketBuilder();
        CodecSetup cSetup = new CodecSetup(null);
        cSetup.BlockSizes[0] = 256;
        cSetup.BlockSizes[1] = 2048;

        VorbisInfo info = new VorbisInfo(cSetup, channels, frequency, 0);

        OggPacket headerInfo = hpb.BuildInfoPacket(info);

        Comments comments = new Comments();
        if (loopStart > 0 && loopEnd > 0)
        {
            comments.AddTag("LOOP_START", loopStart.ToString());
            comments.AddTag("LOOP_END", loopEnd.ToString());
        }
        OggPacket headerComment = hpb.BuildCommentsPacket(comments);

        // The setup header is a fixed blob in OggVorbisHeader.cs; the harness
        // takes it as input so the port does not have to carry the table.
        byte[] setup = Convert.FromBase64String(c.GetProperty("setupHeader").GetString());
        OggPacket headerSetup = new OggPacket(setup, false, 0, 2);

        OggStream output = new OggStream(c.GetProperty("serial").GetInt32());
        output.PacketIn(headerInfo);
        output.PacketIn(headerComment);
        output.PacketIn(headerSetup);

        var stream = new MemoryStream();
        var writer = new BinaryWriter(stream);

        var packets = new List<byte[]>();
        foreach (var p in c.GetProperty("packets").EnumerateArray())
        {
            packets.Add(Convert.FromBase64String(p.GetString()));
        }

        int prevPacketNo = 2;
        int granulePos = 0;
        int prevSamples = 0;

        for (int i = 0; i < packets.Count; i++)
        {
            OggPacket packet = new OggPacket(packets[i], false, 0, prevPacketNo + 1);

            byte firstByte = packet.PacketData[0];
            int noSamples = (firstByte & 2) != 0 ? 2048 : 256;

            if (prevSamples != 0)
            {
                granulePos += (prevSamples + noSamples) / 4;
            }
            packet.GranulePosition = granulePos;
            prevSamples = noSamples;

            packet.EndOfStream = i == packets.Count - 1;
            prevPacketNo = packet.PacketNumber;

            output.PacketIn(packet);
            OggPage page = null;
            if (output.PageOut(out page, true))
            {
                writer.Write(page.Header);
                writer.Write(page.Body);
            }
        }

        writer.Flush();
        return Convert.ToBase64String(stream.ToArray());
    }
}
