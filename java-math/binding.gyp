{
  "targets": [
    {
      "target_name": "java_math",
      "sources": ["src/java_math.cc"],
      "include_dirs": [
        "<!(node scripts/jdk.js include)",
        "<!(node scripts/jdk.js include-platform)"
      ],
      "conditions": [
        ["OS!='win'", { "libraries": ["-ldl"] }]
      ]
    }
  ]
}
