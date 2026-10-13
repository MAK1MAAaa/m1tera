"""Check fixtures or saved live predictions with the SHA-locked BFCL Python scorer.

Python-only import shims avoid installing inference clients and unsupported language
parsers. Scoring functions are not patched. No model inference is performed.
"""
import argparse
from datetime import datetime, timezone
import enum
import hashlib
import json
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parent
SCORER_SHA256 = "2aae7a68461a8f76c0be3894c8901b66b56967a1989d3ab066051e3fb97f1538"


class Language(enum.Enum):
    PYTHON = "python"
    JAVA = "java"
    JAVASCRIPT = "javascript"


def shim(name, **values):
    module = types.ModuleType(name)
    for key, value in values.items():
        setattr(module, key, value)
    sys.modules[name] = module


def unsupported(*_args):
    raise RuntimeError("This offline oracle only supports Python BFCL cases")


def literal_export(filename, marker):
    text = (ROOT / filename).read_text()
    suffix = text.split(marker, 1)[1].lstrip()
    return json.JSONDecoder().raw_decode(suffix)[0]


def load_scorer():
    scorer = (ROOT / "official-bfcl-ast-checker.py").read_bytes()
    if hashlib.sha256(scorer).hexdigest() != SCORER_SHA256:
        raise RuntimeError("Official scorer SHA256 mismatch")
    shim("bfcl_eval.constants.enums", Language=Language)
    shim("bfcl_eval.constants.model_config", MODEL_CONFIG_MAPPING={"m1tera": types.SimpleNamespace(underscore_to_dot=True)})
    shim("bfcl_eval.constants.type_mappings", JAVA_TYPE_CONVERSION={}, JS_TYPE_CONVERSION={})
    shim("bfcl_eval.eval_checker.ast_eval.type_convertor.java_type_converter", java_type_converter=unsupported)
    shim("bfcl_eval.eval_checker.ast_eval.type_convertor.js_type_converter", js_type_converter=unsupported)
    namespace = {}
    exec(compile(scorer, "official-bfcl-ast-checker.py", "exec"), namespace)
    return namespace["ast_checker"]


def check_fixtures(checker, examples):
    fixtures = literal_export("ast-oracle-fixtures.ts", "export const AST_ORACLE_FIXTURES =")
    for fixture in fixtures:
        example = examples[fixture["id"]]
        output = [{call["name"]: call["arguments"]} for call in fixture["calls"]]
        actual = checker(example["functions"], output, example["groundTruth"], Language.PYTHON, example["category"], "m1tera")
        if actual["valid"] != fixture["passed"]:
            raise RuntimeError("AST oracle fixture mismatch: " + fixture["id"] + "/" + fixture["kind"])
    return {"mode": "offline-contract", "oracle_cases": len(fixtures), "passed": len(fixtures), "model_score": None}


def check_live_report(checker, examples, report_path, source):
    original = report_path.read_bytes()
    if len(original) > 8 * 1024 * 1024:
        raise ValueError("Prediction report exceeds 8 MiB")
    report = json.loads(original)
    if report.get("mode") != "live" or report.get("suite") != "bfcl-v4":
        raise ValueError("Only saved live BFCL reports may be graded as live predictions")
    report_source = report.get("source", {})
    for field in ["revision", "subsetSha256", "sourceFileHashes"]:
        if report_source.get(field) != source[field]:
            raise ValueError("Live prediction report uses a different dataset source")
    selected_ids = report_source.get("selectedIds")
    if not isinstance(selected_ids, list) or not selected_ids or len(selected_ids) > 20 or len(set(selected_ids)) != len(selected_ids):
        raise ValueError("Invalid selected task IDs")
    if any(task_id not in examples for task_id in selected_ids) or report.get("total") != len(selected_ids):
        raise ValueError("Only the fixed 20-case subset is supported")
    predictions = report.get("cases")
    if not isinstance(predictions, list):
        raise ValueError("Live report contains no prediction list")
    by_id = {}
    for prediction in predictions:
        task_id = prediction.get("id")
        if task_id not in selected_ids or task_id in by_id:
            raise ValueError("Predictions contain unexpected or duplicate task IDs")
        by_id[task_id] = prediction
    checked = []
    for task_id in selected_ids:
        example = examples[task_id]
        prediction = by_id.get(task_id, {})
        local_status = prediction.get("status")
        entry = {"id": task_id, "category": example["category"], "local_status": local_status,
                 "actual_grade": "unknown", "passed": None, "errors": [], "error_type": None, "agrees_with_local": None}
        calls = prediction.get("calls")
        if local_status not in ["passed", "failed"]:
            entry["errors"] = ["The live report marks this prediction unknown or unattempted"]
        elif not isinstance(calls, list) or any(not isinstance(call, dict) or not isinstance(call.get("name"), str) or not isinstance(call.get("arguments"), dict) for call in calls):
            entry["errors"] = ["Saved prediction is not a valid normalized function-call list"]
        else:
            output = [{call["name"]: call["arguments"]} for call in calls]
            try:
                actual = checker(example["functions"], output, example["groundTruth"], Language.PYTHON, example["category"], "m1tera")
                passed = actual["valid"]
                entry.update({"actual_grade": "passed" if passed else "failed", "passed": passed,
                              "errors": actual.get("error", []), "error_type": actual.get("error_type"),
                              "agrees_with_local": passed == (local_status == "passed")})
            except Exception as error:
                entry["errors"] = ["Official scorer could not grade this prediction: " + type(error).__name__]
        checked.append(entry)
    correct = sum(case["passed"] is True for case in checked)
    incorrect = sum(case["passed"] is False for case in checked)
    graded = correct + incorrect
    compared = [case for case in checked if case["agrees_with_local"] is not None]
    disagreements = [case["id"] for case in compared if not case["agrees_with_local"]]
    categories = {}
    for category in ["simple_python", "multiple"]:
        rows = [case for case in checked if case["category"] == category]
        categories[category] = {"correct": sum(case["passed"] is True for case in rows),
                                "incorrect": sum(case["passed"] is False for case in rows),
                                "unknown": sum(case["passed"] is None for case in rows), "total": len(rows)}
    return {"mode": "official-scorer-on-live-predictions", "suite": "bfcl-v4", "model": report.get("model"),
            "checked_at": datetime.now(timezone.utc).isoformat(), "prediction_report_sha256": hashlib.sha256(original).hexdigest(),
            "source": {"revision": source["revision"], "upstream": source["upstream"], "source_file_hashes": source["sourceFileHashes"],
                       "subset_sha256": source["subsetSha256"], "selected_ids": selected_ids},
            "scorer": {"sha256": SCORER_SHA256,
                       "source_url": source["sourceFileUrls"]["bfcl_ast_checker.py"], "code_modified": False,
                       "dependency_shim": "Python enum and OpenAI dot-to-underscore registry only; Java/JavaScript paths unavailable"},
            "scope": {"fixed_subset_only": True, "full_leaderboard_score": False, "inference_calls": 0,
                      "raw_wire_argument_literals_available": False,
                      "note": "Official Python scorer applied to saved normalized calls, not raw API wire arguments; this is a local fixed subset, not a full leaderboard submission"},
            "metrics": {"correct": correct, "incorrect": incorrect, "unknown": len(checked) - graded, "graded": graded,
                        "total": len(checked), "accuracy": correct / graded if graded else None, "denominator": "graded cases"},
            "local_grader_comparison": {"compared": len(compared), "agreement_count": len(compared) - len(disagreements),
                                        "disagreement_ids": disagreements, "all_agree": not disagreements if compared else None},
            "categories": categories, "cases": checked}


def main():
    parser = argparse.ArgumentParser(description="Verify fixed BFCL fixtures or saved live predictions without model calls")
    parser.add_argument("--report", type=Path, help="Saved live BFCL prediction report")
    parser.add_argument("--output", type=Path, help="Write the full scorer check to this JSON path")
    args = parser.parse_args()
    checker = load_scorer()
    raw_examples = literal_export("data.ts", "export const BFCL_CASES: readonly BfclExample[] =")
    examples = {item["id"]: item for item in raw_examples}
    source = json.loads((ROOT / "sources.json").read_text())["bfcl-v4"]
    subset_hash = hashlib.sha256(json.dumps(raw_examples, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    if subset_hash != source["subsetSha256"]:
        raise ValueError("Vendored fixed subset SHA256 mismatch")
    result = check_live_report(checker, examples, args.report, source) if args.report else check_fixtures(checker, examples)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        summary = {key: result[key] for key in ["mode", "metrics", "local_grader_comparison"] if key in result}
        print(json.dumps(summary or result, ensure_ascii=False))
    else:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
