# 넘버링 체크 수동 테스트 문서

`numbering_validation.py`는 단위 테스트(`backend/tests/qa_engine/test_numbering_validation.py`)로
로직 자체는 검증되지만, 실제 Confluence 페이지 → 복제본 생성 → APPLY_ISSUE_EDIT → 재검증까지
이어지는 전체 흐름은 실제 브라우저에서 확인해야 한다. 이 폴더의 각 파일을 Confluence 테스트
페이지 본문으로 붙여넣고, QA 완료 → 넘버링 체크 화면에서 기대 결과(각 파일 맨 위 인용구)와
비교한다.

| 파일 | 케이스 | 기대 결과 |
|---|---|---|
| `case-a-normal.md` | 정상 문서 | 넘버링 체크 화면 없이 바로 검토 종료 |
| `case-b-missing.md` | 번호 누락 | `1-3` → `1-2` 자동 수정 제안 |
| `case-c-duplicate.md` | 번호 중복 | 마지막 `1-2` → `1-3` 자동 수정 제안 |
| `case-d-order.md` | 번호 순서 오류 | `1-3`↔`1-2`가 서로 뒤바뀌는 두 건의 자동 수정 제안 |
| `case-e-structural-move.md` | 구조 이동(모호) | `1-2`가 🟡 확인 필요로 표시, 자동 수정 후보 아님 |

각 파일을 테스트할 때는 제목 텍스트/공백/구두점이 번호 수정 전후로 그대로인지도 함께 확인한다.
