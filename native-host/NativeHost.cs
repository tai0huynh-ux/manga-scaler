using System;
using System.Diagnostics;
using System.IO;

internal static class NativeHost
{
    private static int Main()
    {
        string hostDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string root = Path.GetFullPath(Path.Combine(hostDirectory, ".."));
        string python = Path.Combine(root, ".venv", "Scripts", "python.exe");
        string launcher = Path.Combine(hostDirectory, "launcher.py");

        if (!File.Exists(python) || !File.Exists(launcher))
        {
            WriteError("Native launcher files are missing.");
            return 1;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = python,
            Arguments = Quote(launcher),
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        try
        {
            using (Process process = Process.Start(startInfo))
            {
                Stream input = Console.OpenStandardInput();
                Stream output = Console.OpenStandardOutput();
                CopyNativeMessage(input, process.StandardInput.BaseStream);
                process.StandardInput.Close();
                CopyNativeMessage(process.StandardOutput.BaseStream, output);
                output.Flush();
                process.WaitForExit(15000);
                return process.HasExited ? process.ExitCode : 0;
            }
        }
        catch (Exception error)
        {
            WriteError("Unable to start hidden native launcher: " + error.Message);
            return 1;
        }
    }

    private static void CopyNativeMessage(Stream source, Stream destination)
    {
        byte[] header = ReadExactly(source, 4);
        if (header.Length != 4)
        {
            return;
        }

        int length = BitConverter.ToInt32(header, 0);
        if (length < 0 || length > 1024 * 1024)
        {
            throw new InvalidDataException("Invalid native message length.");
        }

        byte[] payload = ReadExactly(source, length);
        if (payload.Length != length)
        {
            throw new EndOfStreamException("Incomplete native message.");
        }

        destination.Write(header, 0, header.Length);
        destination.Write(payload, 0, payload.Length);
        destination.Flush();
    }

    private static byte[] ReadExactly(Stream stream, int length)
    {
        byte[] result = new byte[length];
        int offset = 0;
        while (offset < length)
        {
            int read = stream.Read(result, offset, length - offset);
            if (read <= 0)
            {
                break;
            }
            offset += read;
        }

        if (offset == length)
        {
            return result;
        }

        byte[] partial = new byte[offset];
        Buffer.BlockCopy(result, 0, partial, 0, offset);
        return partial;
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void WriteError(string message)
    {
        string json = "{\"ok\":false,\"error\":\"" +
            message.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}";
        byte[] payload = System.Text.Encoding.UTF8.GetBytes(json);
        Stream output = Console.OpenStandardOutput();
        byte[] header = BitConverter.GetBytes(payload.Length);
        output.Write(header, 0, header.Length);
        output.Write(payload, 0, payload.Length);
        output.Flush();
    }
}
