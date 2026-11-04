# ImageNet 전환 준비 — 2026-10-28

## 후속 실행 상태 (같은 날)
사용자가 Hugging Face 로그인을 완료했고 공식 ILSVRC/imagenet-1k 파일 접근을 확인했다. 아래의 계정 미확보 설명은 이전 상태다. revision `49e2ee26f3810fb5a7536bbf732a7b07389a47b5`의 train 첫24장을 스트리밍으로 저장했다. `scripts/recognition-lab/imagenet-sample.py`로 재현하며 출처·행번호·레이블은 `eval/recognition/imagenet-contour-20261028/acquisition.json`에 기록했다. 이는 영역 분리 점검용 편의 표본이며 학습/평가 세트가 아니다. 공식 test split 사진은 다운로드하지 않았다.

사용자 지시대로 `feature-points.py`에서 두 간격의 회전각이 모두40도 이상인 국소 특징을 검출하고 인접 중복을 억제한다. 검출 특징은 필수로 유지하고 남은 점은 공간상 빈 구간을 채운다. 16점보다 특징이 많으면 feature_overflow로 보류하며 임의 삭제하지 않는다. 단순 사각형 꼭짓점 보존·점수 제한·overflow·순환 이동 검사를 통과했다. 의미적으로 중요한 모든 특징을 찾는다는 뜻은 아니다. 완만한 곡선 특징 검출과 픽셀 계단 잡음 제거는 아직 미해결이다.

전처리 출력에는 256점 윤곽, featureInput, 같은 개수의 uniformInput을 추가했다. overflow는 16점 대조 실험에 그대로 넣으면 안 된다. 기존64점 학습 정답에 작은 특징이 빠질 가능성도 별도로 점검해야 한다. 기존 학습 모델은 재학습하지 않았다.

다음 단계: 24장 사진의 대상 영역 분리와 마스크 품질 감사 → 학습 종류/표본 고정 → 특징점 보존 대조 실험. 현재는 승인·사진 확보·점 추출 시제품까지 완료했고 ImageNet 학습 성능은 아직 없다.

사용자는 Quick Draw 대신 ImageNet 사진 기반 실험을 요청했다. 현재 승인 계정 및 내려받은 자료가 없다고 확인했다. 실제 ImageNet 사진 다운로드·영역 분리·모델 학습은 아직 수행하지 않았다. 기존 Quick Draw 결과를 ImageNet 결과로 표시하지 않는다.

## 자료 접근
- 공식 계정 등록: https://www.image-net.org/signup
- 다운로드 안내: https://www.image-net.org/download-images.php
- 원본 접근 신청: https://image-net.org/request
- 공식 bounding box 안내: https://www.image-net.org/download-bboxes

공식 안내는 로그인·접근 신청 및 이용 조건 확인을 요구한다. 사용자가 등록·승인을 진행해야 한다. 비밀번호를 대화에 입력할 필요 없다. ImageNet은 사진 저작권을 소유하지 않으며 데이터 접근과 앱 배포 권리는 동일하지 않다. 비공식 미러로 접근 요건을 우회하지 않는다.

## 준비한 도구
`scripts/recognition-lab/imagenet-contours.py`: 사진과 검토 완료된 사물 마스크에서 단일 외곽을 추출하고 위가 양수인 정규화64점 좌표로 변환한다. 원본 사진 해시 기준으로 학습/검증/평가를 분리하며 동일 사진 중복, 프레임에 잘린 사물, 여러 성분/구멍, 미검토 마스크는 제외 이유를 기록한다. 엄격한 초기 선별이며 모든 사물 형태에 적용 가능한 규칙은 아니다. 근접 중복은 별도 감사가 필요하다.

마스크 생성 모델은 아직 연결하지 않았다. bounding box를 외곽선 정답으로 사용하지 않는다. 이 도구는 외곽 전처리 도구이며 학습 완료를 의미하지 않는다.

## 자료 배치
gitignored `eval/recognition/imagenet-contour-20261028/` 아래 images/, masks/, manifest.json을 둔다. manifest 예시:

```json
[
  {
    "id": "official-image-id",
    "label": "official-synset-id",
    "source": "official ImageNet release and original identifier",
    "image": "images/example.JPEG",
    "mask": "masks/example.png",
    "reviewed": true
  }
]
```

마스크 흰색은 사물, 검정은 배경이며 사진과 크기가 같아야 한다. 실제 검토 없이 reviewed를 true로 설정하지 않는다.

```powershell
& eval/recognition/model-env/Scripts/python.exe scripts/recognition-lab/imagenet-contours.py eval/recognition/imagenet-contour-20261028/manifest.json eval/recognition/imagenet-contour-20261028/contours.json
```

## 자료 확보 이후
1. 승인된 원본과 제공되는 위치 주석을 확인한다. 전체 데이터 다운로드보다 필요한 소수 종류부터 시작한다.
2. 대상 영역 분리 모델로 마스크 초안을 만들고 사진/마스크/외곽 비교 화면에서 품질 검토한다.
3. 실제 제공 종류를 확인해 종류 매핑과 표본 수를 사전에 고정한다. Quick Draw의 apple/fish/bird와 ImageNet 종류를 자동으로 동일시하지 않는다.
4. 사진 원본 단위 분할 후 부분 점을 생성한다. 점 조건부 모델·그림 검색·보간을 동일 조건으로 비교한다.
5. 사진 외곽 복원 성능과 도로 변환 성능을 분리한다. ImageNet의 성능 향상 여부는 아직 미정이다.

현재 진행을 막는 항목은 승인된 원본 자료다. 자료 확보 전 합성 마스크로 확인한 것은 전처리 함수의 동작일 뿐 ImageNet 모델 성능이 아니다.
