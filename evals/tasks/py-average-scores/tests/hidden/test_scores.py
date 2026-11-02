import os
import tempfile
import unittest

from scores import average_scores


class TestScores(unittest.TestCase):
    def write(self, text):
        fd, path = tempfile.mkstemp(suffix=".csv")
        with os.fdopen(fd, "w") as f:
            f.write(text)
        self.addCleanup(os.remove, path)
        return path

    def test_averages_and_skips(self):
        path = self.write("name,score\nada,90\nada,85\ngrace,\nlinus,abc\ngrace,77\n")
        self.assertEqual(average_scores(path), {"ada": 87.5, "grace": 77.0})

    def test_rounding(self):
        path = self.write("name,score\nx,1\nx,2\nx,2\n")
        self.assertEqual(average_scores(path), {"x": 1.67})


if __name__ == "__main__":
    unittest.main()
