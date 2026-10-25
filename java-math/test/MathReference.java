import java.io.*;

// Reads doubles from stdin and writes the raw bits of Math.sin and Math.cos of each, in a JVM of its own.
class MathReference {
    public static void main(String[] args) throws IOException {
        DataInputStream input = new DataInputStream(new BufferedInputStream(System.in));
        DataOutputStream output = new DataOutputStream(new BufferedOutputStream(System.out));
        while (true) {
            double x;
            try { x = input.readDouble(); } catch (EOFException end) { break; }
            output.writeLong(Double.doubleToRawLongBits(Math.sin(x)));
            output.writeLong(Double.doubleToRawLongBits(Math.cos(x)));
        }
        output.flush();
    }
}
