@echo off
setlocal

cd /d "%~dp0"

call ..\candlenv\Scripts\activate.bat

pytest ^
    test_00_conftest_sanity.py ^
    test_manifest_transitions.py ^
    test_processor_idempotency.py ^
    test_atomicity_rollback.py ^
    test_db_integrity.py ^
    test_schema_validation.py ^
    test_api_responses.py ^
    -v

pause