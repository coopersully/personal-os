"""Decode one bounded JSON entry. Never extract or execute artifact content."""
import io
import json
import sys
import zipfile

MAX_ARCHIVE = 65536
MAX_ENTRY = 16384


def decode_archive(raw):
    if len(raw) > MAX_ARCHIVE:
        raise ValueError("archive_size")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        if len(entries) != 1:
            raise ValueError("archive_entries")
        entry = entries[0]
        if (entry.filename != "source-candidate.json" or entry.is_dir()
                or entry.file_size > MAX_ENTRY or entry.flag_bits & 1
                or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            raise ValueError("archive_entry")
        with archive.open(entry) as stream:
            content = stream.read(MAX_ENTRY + 1)
        if len(content) > MAX_ENTRY:
            raise ValueError("decoded_size")
        def pairs(values):
            result = {}
            for key, value in values:
                if key in result:
                    raise ValueError("duplicate_json_key")
                result[key] = value
            return result
        return json.loads(content, object_pairs_hook=pairs)


if __name__ == "__main__":
    try:
        print(json.dumps(decode_archive(sys.stdin.buffer.read(MAX_ARCHIVE + 1))))
    except Exception:
        sys.exit("Source receipt archive rejected")
